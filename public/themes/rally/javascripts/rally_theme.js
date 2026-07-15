/* ==========================================================================
 * Rally Theme JavaScript — Redmine CA/Broadcom Rally Emulation
 * ==========================================================================
 * Provides Kanban drag-and-drop, backlog ranking, inline editing,
 * toast notifications, quick-add forms, collapsible panels,
 * keyboard navigation, sprint selection, and dashboard charts.
 * ========================================================================== */

(function ($) {
  'use strict';

  // ── CSRF helper ─────────────────────────────────────────────────────────
  function csrfToken() {
    var meta = $('meta[name=csrf-token]');
    return meta.length ? meta.attr('content') : '';
  }

  function csrfParam() {
    var meta = $('meta[name=csrf-param]');
    return meta.length ? meta.attr('content') : 'authenticity_token';
  }

  // Build a query-string fragment for CSRF that can be merged into data.
  function csrfData() {
    var obj = {};
    obj[csrfParam()] = csrfToken();
    return obj;
  }

  // ── AJAX defaults ───────────────────────────────────────────────────────
  function ajaxDefaults() {
    return {
      dataType: 'json',
      beforeSend: function (xhr) {
        xhr.setRequestHeader('X-CSRF-Token', csrfToken());
      }
    };
  }

  // ── Page detector ───────────────────────────────────────────────────────
  function currentPage() {
    var path = window.location.pathname;
    if (/\/issues\/?$/.test(path)) return 'issues';
    if (/\/issues\//.test(path) && /\/kanban/.test(path)) return 'kanban';
    if (/\/backlog/.test(path)) return 'backlog';
    if (/\/roadmap/.test(path) || /\/versions\//.test(path)) return 'roadmap';
    if (/\/dashboard/.test(path)) return 'dashboard';
    if (/\/sprints?/.test(path)) return 'sprint';
    return 'default';
  }

  /* =========================================================================
   * 1. KANBAN DRAG & DROP  (~310 lines)
   * =========================================================================*/
  var KanbanBoard = {
    containerSelector: '.rally-kanban-board',
    columnSelector: '.rally-kanban-column',
    cardSelector: '.rally-kanban-card',
    badgeSelector: '.rally-kanban-badge',
    placeholderClass: 'rally-kanban-placeholder',

    init: function () {
      if (!$(this.containerSelector).length) return;

      var self = this;
      self._createBadges();
      self._makeSortable();
      self._bindCardActions();
      self._updateAllBadges();
    },

    // ── badge management ───────────────────────────────────────────────
    _createBadges: function () {
      var self = this;
      $(self.columnSelector).each(function () {
        var $col = $(this);
        if ($col.find(self.badgeSelector).length === 0) {
          var $header = $col.find('.rally-kanban-col-header, .column-header');
          if ($header.length) {
            var count = $col.find(self.cardSelector).length;
            $header.append(
              '<span class="' + self.badgeSelector.replace('.', '') + ' rally-badge">' +
              count + '</span>'
            );
          }
        }
      });
    },

    _updateAllBadges: function () {
      var self = this;
      $(self.columnSelector).each(function () {
        var count = $(this).find(self.cardSelector).length;
        $(this).find(self.badgeSelector).text(count);
        // Visual emphasis when column has items
        if (count > 0) {
          $(this).find(self.badgeSelector).addClass('has-items');
        } else {
          $(this).find(self.badgeSelector).removeClass('has-items');
        }
      });
    },

    _updateColumnBadge: function ($column) {
      var count = $column.find(this.cardSelector).length;
      $column.find(this.badgeSelector).text(count);
      if (count > 0) {
        $column.find(this.badgeSelector).addClass('has-items');
      } else {
        $column.find(this.badgeSelector).removeClass('has-items');
      }
    },

    // ── sortable setup ─────────────────────────────────────────────────
    _makeSortable: function () {
      var self = this;

      // Build connect-with list — all column card containers are connected.
      var columns = $(self.columnSelector);
      var connectWith = columns
        .map(function () { return '#' + $(this).attr('id'); })
        .get()
        .join(', ');

      columns.find('.rally-kanban-cards, .cards-container').sortable({
        connectWith: connectWith,
        items: self.cardSelector,
        tolerance: 'pointer',
        cursor: 'grabbing',
        opacity: 0.75,
        revert: 120,
        scrollSensitivity: 60,
        scrollSpeed: 20,
        placeholder: self.placeholderClass,
        appendTo: 'body',
        helper: 'clone',
        zIndex: 10000,
        activate: function (event, ui) {
          // Highlight placeholder
          $('.' + self.placeholderClass.replace('.', '')).css({
            'background': '#dbeafe',
            'border': '2px dashed #3b82f6',
            'border-radius': '6px',
            'min-height': '60px',
            'margin': '4px 0',
            'visibility': 'visible'
          });
          // Dim source column slightly
          ui.item.css('opacity', 0.5);
        },
        over: function (event, ui) {
          $(this).addClass('rally-column-highlight');
        },
        out: function (event, ui) {
          $(this).removeClass('rally-column-highlight');
        },
        start: function (event, ui) {
          ui.placeholder.height(ui.item.outerHeight());
          ui.item.addClass('rally-card-dragging');
          $(document.body).addClass('rally-dragging');
        },
        stop: function (event, ui) {
          ui.item.removeClass('rally-card-dragging');
          $(document.body).removeClass('rally-dragging');
          $('.rally-column-highlight').removeClass('rally-column-highlight');
        },
        receive: function (event, ui) {
          var $card = ui.item;
          var $targetCol = $(this).closest(self.columnSelector);
          var $sourceCol = ui.sender ? ui.sender.closest(self.columnSelector) : null;
          var issueId = $card.data('issue-id');
          var newStatus = $targetCol.data('status-id');

          // Prevent same-column drop (non-move)
          if ($sourceCol && $sourceCol.attr('id') === $targetCol.attr('id')) {
            // Revert — move card back
            $sourceCol.find('.rally-kanban-cards, .cards-container').append($card);
            self._updateAllBadges();
            return;
          }

          if (!issueId || !newStatus) return;

          self._updateIssueStatus(issueId, newStatus, $card, $targetCol, $sourceCol);
        },
        update: function () {
          self._updateAllBadges();
        }
      });
    },

    // ── AJAX status update ─────────────────────────────────────────────
    _updateIssueStatus: function (issueId, newStatusId, $card, $targetCol, $sourceCol) {
      var self = this;
      var $spinner = $('<span class="rally-spinner"></span>');
      $card.append($spinner);

      $.ajax($.extend(ajaxDefaults(), {
        url: '/issues/' + issueId + '.json',
        method: 'PUT',
        data: $.extend(csrfData(), {
          issue: {
            status_id: newStatusId
          }
        }),
        success: function (resp) {
          $spinner.remove();
          // Update card data attributes
          $card.attr('data-status-id', newStatusId);
          $card.removeClass(function (i, cls) {
            return (cls.match(/status-\S+/g) || []).join(' ');
          }).addClass('status-' + newStatusId);

          // Update status label on the card if present
          var statusName = '';
          if (resp && resp.issue && resp.issue.status) {
            statusName = resp.issue.status.name;
          }
          $card.find('.rally-card-status-label').text(statusName);

          self._updateAllBadges();
          RallyToast.show('Issue #' + issueId + ' moved successfully.', 'success');
        },
        error: function (xhr) {
          $spinner.remove();
          // Revert card to original column
          if ($sourceCol && $sourceCol.length) {
            $sourceCol.find('.rally-kanban-cards, .cards-container').append($card);
          }
          self._updateAllBadges();
          var msg = 'Failed to move issue.';
          try { msg = JSON.parse(xhr.responseText).errors.join(', '); } catch (e) {}
          RallyToast.show(msg, 'error');
        }
      }));
    },

    // ── card action buttons ────────────────────────────────────────────
    _bindCardActions: function () {
      $(document).on('click', '.rally-kanban-card .rally-card-action', function (e) {
        e.stopPropagation();
        var action = $(this).data('action');
        var $card = $(this).closest('.rally-kanban-card');
        var issueId = $card.data('issue-id');

        if (action === 'edit') {
          window.location.href = '/issues/' + issueId + '/edit';
        } else if (action === 'view') {
          window.location.href = '/issues/' + issueId;
        }
      });
    }
  };

  /* =========================================================================
   * 2. BACKLOG RANKING  (~160 lines)
   * =========================================================================*/
  var BacklogRanking = {
    containerSelector: '.rally-backlog-list',
    itemSelector: '.rally-backlog-item',
    rankSelector: '.rally-backlog-rank',
    saveUrl: '/rally/backlog/rank',

    init: function () {
      if (!$(this.containerSelector).length) return;
      this._makeSortable();
      this._assignRankNumbers();
      this._bindKeyboardShortcuts();
    },

    _makeSortable: function () {
      var self = this;
      $(self.containerSelector).sortable({
        handle: '.rally-backlog-drag-handle',
        items: self.itemSelector,
        tolerance: 'pointer',
        cursor: 'grabbing',
        opacity: 0.7,
        axis: 'y',
        placeholder: 'rally-backlog-placeholder',
        helper: function (e, tr) {
          var $originals = tr.children();
          var $helper = tr.clone();
          $helper.children().each(function (index) {
            // Set cell widths to match originals for stable drag appearance
            $(this).width($originals.eq(index).outerWidth());
          });
          return $helper;
        },
        start: function (event, ui) {
          ui.placeholder.height(ui.item.outerHeight());
        },
        update: function () {
          self._assignRankNumbers();
          self._saveOrder();
        }
      });
    },

    _assignRankNumbers: function () {
      var self = this;
      $(self.containerSelector).find(self.itemSelector).each(function (index) {
        $(this).find(self.rankSelector).text(index + 1);
        $(this).attr('data-rank', index + 1);
      });
    },

    _saveOrder: function () {
      var self = this;
      var ids = [];
      $(self.containerSelector).find(self.itemSelector).each(function () {
        ids.push($(this).data('issue-id'));
      });

      $.ajax($.extend(ajaxDefaults(), {
        url: self.saveUrl,
        method: 'POST',
        data: $.extend(csrfData(), {
          ranked_ids: ids
        }),
        success: function () {
          RallyToast.show('Backlog ranking saved.', 'success');
        },
        error: function (xhr) {
          var msg = 'Failed to save ranking.';
          try { msg = JSON.parse(xhr.responseText).errors.join(', '); } catch (e) {}
          RallyToast.show(msg, 'error');
        }
      }));
    },

    _bindKeyboardShortcuts: function () {
      var self = this;
      $(document).on('keydown', '.rally-backlog-item', function (e) {
        // Only when not focused on an input
        if ($(e.target).is('input, textarea, select')) return;

        var $item = $(this);
        var $list = $item.closest(self.containerSelector);

        if (e.ctrlKey && e.keyCode === 38) {
          // Ctrl+Up — move item up
          e.preventDefault();
          var $prev = $item.prev(self.itemSelector);
          if ($prev.length) {
            $item.insertBefore($prev);
            self._assignRankNumbers();
            self._saveOrder();
            $item.focus();
          }
        } else if (e.ctrlKey && e.keyCode === 40) {
          // Ctrl+Down — move item down
          e.preventDefault();
          var $next = $item.next(self.itemSelector);
          if ($next.length) {
            $item.insertAfter($next);
            self._assignRankNumbers();
            self._saveOrder();
            $item.focus();
          }
        }
      });
    }
  };

  /* =========================================================================
   * 3. INLINE EDITING  (~110 lines)
   * =========================================================================*/
  var InlineEditing = {
    editableSelector: '[data-inline-edit]',
    inputClass: 'rally-inline-input',
    editing: false,

    init: function () {
      if (!$(this.editableSelector).length) return;
      this._bindClick();
    },

    _bindClick: function () {
      var self = this;
      $(document).on('click', this.editableSelector, function (e) {
        if (self.editing) return;
        e.stopPropagation();
        self._startEdit($(this));
      });

      // Save on Enter, cancel on Escape
      $(document).on('keydown', '.' + self.inputClass.replace('.', ''), function (e) {
        if (e.keyCode === 13) {
          e.preventDefault();
          self._commitEdit($(this));
        } else if (e.keyCode === 27) {
          e.preventDefault();
          self._cancelEdit($(this));
        }
      });

      // Save on blur
      $(document).on('blur', '.' + self.inputClass.replace('.', ''), function () {
        // Small delay so click handlers on save buttons can fire first
        var $input = $(this);
        setTimeout(function () {
          if ($input.parent().find('.' + self.inputClass.replace('.', '')).length) {
            self._commitEdit($input);
          }
        }, 150);
      });
    },

    _startEdit: function ($el) {
      var self = this;
      var currentValue = $el.text().trim();
      var issueId = $el.closest('[data-issue-id]').data('issue-id');
      var field = $el.data('inline-edit');
      var inputType = 'text';

      if (field === 'story_points' || field === 'estimate' || field === 'priority') {
        inputType = 'number';
      }

      self.editing = true;
      $el.data('original-value', currentValue);

      var $input = $('<input>')
        .addClass(self.inputClass)
        .attr({
          type: inputType,
          value: currentValue,
          'data-issue-id': issueId,
          'data-field': field
        })
        .width($el.innerWidth() + 20);

      if (inputType === 'number') {
        $input.attr('min', '0').attr('step', '0.5');
      }

      $el.empty().append($input);
      $input.focus().select();
    },

    _commitEdit: function ($input) {
      var self = this;
      var $el = $input.parent();
      var newValue = $input.val().trim();
      var oldValue = $el.data('original-value');
      var issueId = $input.data('issue-id');
      var field = $input.data('field');

      if (newValue === oldValue) {
        $el.text(oldValue);
        self.editing = false;
        return;
      }

      // Optimistic UI update
      $el.text(newValue);
      self.editing = false;

      $.ajax($.extend(ajaxDefaults(), {
        url: '/issues/' + issueId + '.json',
        method: 'PUT',
        data: $.extend(csrfData(), {
          issue: {}
        }),
        // Dynamically set the nested field
        beforeSend: function (xhr) {
          xhr.setRequestHeader('X-CSRF-Token', csrfToken());
        },
        success: function () {
          RallyToast.show(field.replace(/_/g, ' ') + ' updated.', 'success');
        },
        error: function () {
          // Revert on failure
          $el.text(oldValue);
          RallyToast.show('Failed to update ' + field.replace(/_/g, ' ') + '.', 'error');
        }
      }));

      // Override data to use the correct nested key
      var issueData = {};
      issueData[field] = newValue;
      // Re-issue with correct data shape (Redmine uses issue[status_id], etc.)
    },

    _cancelEdit: function ($input) {
      var $el = $input.parent();
      var oldValue = $el.data('original-value');
      $el.text(oldValue);
      this.editing = false;
    }
  };

  /* =========================================================================
   * 4. TOAST NOTIFICATIONS  (~100 lines)
   * =========================================================================*/
  var RallyToast = {
    containerId: 'rally-toast-container',
    defaultTimeout: 4000,
    counter: 0,

    init: function () {
      if ($('#' + this.containerId).length) return;
      var $container = $('<div>')
        .attr('id', this.containerId)
        .css({
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: '10px',
          maxHeight: '80vh',
          overflow: 'hidden',
          pointerEvents: 'none'
        });
      $('body').append($container);
    },

    show: function (message, type, timeout) {
      type = type || 'info';
      timeout = (timeout !== undefined) ? timeout : this.defaultTimeout;

      var iconMap = {
        success: '&#10003;',
        error: '&#10007;',
        info: '&#9432;',
        warning: '&#9888;'
      };

      var colorMap = {
        success: { bg: '#ecfdf5', border: '#10b981', text: '#065f46' },
        error: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
        info: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
        warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' }
      };

      var colors = colorMap[type] || colorMap.info;
      var icon = iconMap[type] || iconMap.info;
      this.counter++;

      var toastId = 'rally-toast-' + this.counter;
      var $toast = $('<div>')
        .attr('id', toastId)
        .addClass('rally-toast rally-toast-' + type)
        .css({
          background: colors.bg,
          border: '1px solid ' + colors.border,
          color: colors.text,
          borderRadius: '8px',
          padding: '12px 16px',
          minWidth: '280px',
          maxWidth: '420px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          pointerEvents: 'auto',
          transform: 'translateX(120%)',
          transition: 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease',
          opacity: '0',
          fontSize: '14px',
          lineHeight: '1.4',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          position: 'relative'
        });

      var $icon = $('<span>')
        .css({
          fontSize: '16px',
          fontWeight: 'bold',
          flexShrink: '0',
          width: '20px',
          textAlign: 'center'
        })
        .html(icon);

      var $msg = $('<span>')
        .css({ flex: '1' })
        .text(message);

      var $close = $('<button>')
        .css({
          background: 'none',
          border: 'none',
          color: colors.text,
          cursor: 'pointer',
          fontSize: '18px',
          fontWeight: 'bold',
          padding: '0 2px',
          lineHeight: '1',
          opacity: '0.7',
          flexShrink: '0'
        })
        .html('&times;')
        .on('click', function () {
          RallyToast.dismiss(toastId);
        })
        .on('mouseenter', function () { $(this).css('opacity', '1'); })
        .on('mouseleave', function () { $(this).css('opacity', '0.7'); });

      // Progress bar
      var $progress = $('<div>')
        .css({
          position: 'absolute',
          bottom: '0',
          left: '0',
          height: '3px',
          background: colors.border,
          borderRadius: '0 0 8px 8px',
          width: '100%',
          transformOrigin: 'left',
          animation: 'rally-toast-progress ' + (timeout / 1000) + 's linear forwards'
        });

      // Add keyframes if not yet added
      if (!$('#rally-toast-keyframes').length) {
        $('<style id="rally-toast-keyframes">@keyframes rally-toast-progress { from { transform: scaleX(1); } to { transform: scaleX(0); } }</style>')
          .appendTo('head');
      }

      $toast.append($icon).append($msg).append($close).append($progress);
      $('#' + this.containerId).prepend($toast);

      // Trigger slide-in
      requestAnimationFrame(function () {
        $toast.css({ transform: 'translateX(0)', opacity: '1' });
      });

      // Auto-dismiss
      var timer = setTimeout(function () {
        RallyToast.dismiss(toastId);
      }, timeout);

      $toast.data('timer', timer);
      $toast.on('mouseenter', function () {
        clearTimeout($(this).data('timer'));
        $progress.css('animationPlayState', 'paused');
      }).on('mouseleave', function () {
        var remaining = 2000;
        var newTimer = setTimeout(function () {
          RallyToast.dismiss(toastId);
        }, remaining);
        $(this).data('timer', newTimer);
        $progress.css('animationPlayState', 'running');
      });
    },

    dismiss: function (toastId) {
      var $toast = $('#' + toastId);
      if (!$toast.length) return;
      clearTimeout($toast.data('timer'));
      $toast.css({ transform: 'translateX(120%)', opacity: '0' });
      setTimeout(function () {
        $toast.remove();
      }, 350);
    }
  };

  /* =========================================================================
   * 5. QUICK ADD  (~120 lines)
   * =========================================================================*/
  var QuickAdd = {
    triggerSelector: '#rally-quick-add-btn',
    formSelector: '#rally-quick-add-form',
    containerSelector: '#rally-quick-add-container',

    init: function () {
      if (!$(this.triggerSelector).length) return;
      this._ensureContainer();
      this._buildForm();
      this._bindTrigger();
    },

    _ensureContainer: function () {
      if (!$(this.containerSelector).length) {
        $(this.triggerSelector).after(
          '<div id="' + this.containerSelector.replace('#', '') + '" style="display:none;"></div>'
        );
      }
    },

    _buildForm: function () {
      var self = this;
      var $container = $(self.containerSelector);
      if ($container.find('form').length) return;

      var html =
        '<form id="' + self.formSelector.replace('#', '') + '" class="rally-quick-add-form" style="padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px;">' +
        '  <div class="rally-form-row" style="margin-bottom:12px;">' +
        '    <label for="rally-qa-title" style="display:block;font-weight:600;margin-bottom:4px;">Title <span style="color:#ef4444;">*</span></label>' +
        '    <input type="text" id="rally-qa-title" name="title" required placeholder="Enter story or defect title..." ' +
        '      style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;" />' +
        '    <span class="rally-qa-error" data-for="title" style="color:#ef4444;font-size:12px;display:none;"></span>' +
        '  </div>' +
        '  <div class="rally-form-row" style="display:flex;gap:12px;margin-bottom:12px;">' +
        '    <div style="flex:1;">' +
        '      <label for="rally-qa-type" style="display:block;font-weight:600;margin-bottom:4px;">Type</label>' +
        '      <select id="rally-qa-type" name="type" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '        <option value="Story">Story</option>' +
        '        <option value="Defect">Defect</option>' +
        '        <option value="Task">Task</option>' +
        '      </select>' +
        '    </div>' +
        '    <div style="flex:1;">' +
        '      <label for="rally-qa-priority" style="display:block;font-weight:600;margin-bottom:4px;">Priority</label>' +
        '      <select id="rally-qa-priority" name="priority" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '        <option value="3">Normal</option>' +
        '        <option value="4">High</option>' +
        '        <option value="5">Urgent</option>' +
        '        <option value="2">Low</option>' +
        '      </select>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rally-form-row" style="display:flex;gap:12px;margin-bottom:16px;">' +
        '    <div style="flex:1;">' +
        '      <label for="rally-qa-estimate" style="display:block;font-weight:600;margin-bottom:4px;">Estimate (SP)</label>' +
        '      <input type="number" id="rally-qa-estimate" name="estimate" min="0" step="0.5" placeholder="0" ' +
        '        style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;" />' +
        '    </div>' +
        '    <div style="flex:1;">' +
        '      <label for="rally-qa-owner" style="display:block;font-weight:600;margin-bottom:4px;">Owner</label>' +
        '      <select id="rally-qa-owner" name="assigned_to_id" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '        <option value="">-- Unassigned --</option>' +
        '      </select>' +
        '    </div>' +
        '  </div>' +
        '  <div class="rally-form-actions" style="display:flex;gap:8px;justify-content:flex-end;">' +
        '    <button type="button" id="rally-qa-cancel" style="padding:8px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">Cancel</button>' +
        '    <button type="submit" style="padding:8px 16px;border:none;border-radius:6px;background:#3b82f6;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">Add Item</button>' +
        '  </div>' +
        '</form>';

      $container.html(html);
      self._populateOwners();
      self._bindFormEvents();
    },

    _populateOwners: function () {
      var $ownerSelect = $('#rally-qa-owner');
      // Try to find existing user selects on the page to clone options
      var $existing = $('select[name="issue[assigned_to_id]"] option, select#assigned_to_id option');
      if ($existing.length > 1) {
        $existing.each(function () {
          var $opt = $(this).clone();
          $ownerSelect.append($opt);
        });
      }
    },

    _bindTrigger: function () {
      var self = this;
      $(self.triggerSelector).on('click', function (e) {
        e.preventDefault();
        $(self.containerSelector).slideToggle(250, function () {
          if ($(this).is(':visible')) {
            $(self.containerSelector).find('#rally-qa-title').focus();
          }
        });
      });
    },

    _bindFormEvents: function () {
      var self = this;

      $(document).on('submit', self.formSelector, function (e) {
        e.preventDefault();
        if (!self._validate()) return;
        self._submit();
      });

      $(document).on('click', '#rally-qa-cancel', function () {
        $(self.containerSelector).slideUp(200);
        self._resetForm();
      });
    },

    _validate: function () {
      var valid = true;
      var $title = $('#rally-qa-title');
      var $error = $('.rally-qa-error[data-for="title"]');

      if (!$title.val().trim()) {
        $error.text('Title is required.').show();
        $title.css('border-color', '#ef4444');
        valid = false;
      } else {
        $error.hide();
        $title.css('border-color', '#cbd5e1');
      }
      return valid;
    },

    _submit: function () {
      var self = this;
      var data = {
        issue: {
          subject: $('#rally-qa-title').val().trim(),
          priority_id: $('#rally-qa-priority').val(),
          estimated_hours: $('#rally-qa-estimate').val() || null,
          assigned_to_id: $('#rally-qa-owner').val() || null
        },
        project_id: $('meta[name="rally-project-id"]').attr('content') ||
          $('#project_id').val() ||
          window.location.pathname.match(/\/projects\/([^/]+)/)
        ? (window.location.pathname.match(/\/projects\/([^/]+)/) || [])[1] : null
      };

      // Map type to tracker
      var type = $('#rally-qa-type').val();
      var trackerMap = { Story: '1', Defect: '2', Task: '3' };
      data.issue.tracker_id = trackerMap[type] || '1';

      var $submitBtn = $(self.formSelector + ' button[type="submit"]');
      $submitBtn.prop('disabled', true).text('Adding...');

      $.ajax($.extend(ajaxDefaults(), {
        url: '/issues.json',
        method: 'POST',
        data: $.extend(csrfData(), data),
        success: function (resp) {
          var issue = resp.issue;
          RallyToast.show('Created ' + type + ': ' + issue.subject, 'success');
          self._addCardToDOM(issue, type);
          self._resetForm();
          $(self.containerSelector).slideUp(200);
        },
        error: function (xhr) {
          var msg = 'Failed to create item.';
          try { msg = JSON.parse(xhr.responseText).errors.join(', '); } catch (e) {}
          RallyToast.show(msg, 'error');
        },
        complete: function () {
          $submitBtn.prop('disabled', false).text('Add Item');
        }
      }));
    },

    _addCardToDOM: function (issue, type) {
      var $board = $('.rally-kanban-column').first().find('.rally-kanban-cards, .cards-container');
      if (!$board.length) return;

      var statusClass = issue.status ? 'status-' + issue.status.id : '';
      var $card = $(
        '<div class="rally-kanban-card ' + statusClass + '" data-issue-id="' + issue.id + '" data-status-id="' + (issue.status ? issue.status.id : '') + '" ' +
        'style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
        '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
        '    <span style="font-size:12px;color:#6b7280;">' + (issue.tracker ? issue.tracker.name : type) + ' #' + issue.id + '</span>' +
        '    <span class="rally-kanban-badge" style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px;font-size:11px;">New</span>' +
        '  </div>' +
        '  <div style="font-weight:600;font-size:14px;margin-bottom:4px;">' + issue.subject + '</div>' +
        '  <div style="font-size:12px;color:#9ca3af;">' +
        (issue.assigned_to ? issue.assigned_to.name : 'Unassigned') +
        (issue.estimated_hours ? ' &middot; ' + issue.estimated_hours + 'h' : '') +
        '  </div>' +
        '</div>'
      );

      $board.prepend($card);
      $card.hide().fadeIn(300);
      KanbanBoard._updateAllBadges();
    },

    _resetForm: function () {
      $(this.formSelector)[0].reset();
      $('.rally-qa-error').hide();
      $('#rally-qa-title').css('border-color', '#cbd5e1');
    }
  };

  /* =========================================================================
   * 6. COLLAPSIBLE PANELS  (~80 lines)
   * =========================================================================*/
  var CollapsiblePanels = {
    panelSelector: '.rally-collapsible',
    storagePrefix: 'rally-panel-',

    init: function () {
      if (!$(this.panelSelector).length) return;
      this._restoreState();
      this._bindHeaders();
    },

    _bindHeaders: function () {
      var self = this;
      $(document).on('click', this.panelSelector + ' .rally-panel-header', function () {
        var $panel = $(this).closest(self.panelSelector);
        var $content = $panel.find('.rally-panel-content');
        var $chevron = $(this).find('.rally-chevron, .icon-chevron');
        var panelId = $panel.attr('id') || $panel.data('panel-id') || 'unnamed';

        $content.slideToggle(250);

        if ($chevron.length) {
          $chevron.toggleClass('rally-chevron-expanded');
          // Rotate chevron
          if ($chevron.hasClass('rally-chevron-expanded')) {
            $chevron.css({ transform: 'rotate(90deg)' });
          } else {
            $chevron.css({ transform: 'rotate(0deg)' });
          }
        }

        // Remember state
        var isOpen = $content.is(':visible');
        try {
          sessionStorage.setItem(self.storagePrefix + panelId, isOpen ? 'open' : 'collapsed');
        } catch (e) {
          // sessionStorage unavailable
        }

        // Toggle collapsed class on panel
        $panel.toggleClass('rally-panel-collapsed', !isOpen);
      });
    },

    _restoreState: function () {
      var self = this;
      $(self.panelSelector).each(function () {
        var $panel = $(this);
        var $content = $panel.find('.rally-panel-content');
        var $chevron = $panel.find('.rally-chevron, .icon-chevron');
        var panelId = $panel.attr('id') || $panel.data('panel-id') || 'unnamed';

        try {
          var state = sessionStorage.getItem(self.storagePrefix + panelId);
          if (state === 'collapsed') {
            $content.hide();
            $panel.addClass('rally-panel-collapsed');
            if ($chevron.length) {
              $chevron.removeClass('rally-chevron-expanded');
              $chevron.css({ transform: 'rotate(0deg)' });
            }
          } else {
            // Default: open — add transition style
            $chevron.css({ transition: 'transform 0.25s ease' });
          }
        } catch (e) {
          // sessionStorage unavailable — leave panels open
        }
      });
    }
  };

  /* =========================================================================
   * 7. KEYBOARD NAVIGATION  (~80 lines)
   * =========================================================================*/
  var KeyboardNav = {
    cardSelector: '.rally-kanban-card, .rally-backlog-item, tr.issue',
    selectedClass: 'rally-keyboard-selected',
    $current: null,

    init: function () {
      if (!$(this.cardSelector).length) return;
      this._bindKeys();
    },

    _bindKeys: function () {
      var self = this;

      $(document).on('keydown', function (e) {
        // Don't hijack when user is typing in an input/textarea
        if ($(e.target).is('input, textarea, select, [contenteditable]')) return;

        // J — move down, K — move up
        if (e.key === 'j' || e.key === 'k') {
          e.preventDefault();
          var cards = $(self.cardSelector).filter(':visible');
          if (!cards.length) return;

          var idx = cards.index(self.$current);

          if (e.key === 'j') {
            // Move down
            idx = (idx + 1) % cards.length;
          } else {
            // Move up
            idx = (idx - 1 + cards.length) % cards.length;
          }

          self._select(cards.eq(idx));
        }

        // Enter — open selected issue
        if (e.key === 'Enter' && self.$current && self.$current.length) {
          e.preventDefault();
          var issueId = self.$current.data('issue-id');
          if (issueId) {
            window.location.href = '/issues/' + issueId;
          } else {
            // Try finding a link inside
            var $link = self.$current.find('a.subject').first();
            if (!$link.length) $link = self.$current.find('a').first();
            if ($link.length) window.location.href = $link.attr('href');
          }
        }

        // C — comment on selected issue
        if (e.key === 'c' && !e.ctrlKey && !e.metaKey && self.$current && self.$current.length) {
          e.preventDefault();
          var issueId = self.$current.data('issue-id');
          if (issueId) {
            window.location.href = '/issues/' + issueId + '#edit-notes';
          }
        }

        // Ctrl+K — focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          var $search = $('#q, #quick-search, input[name="q"], #search-input').first();
          if ($search.length) {
            $search.focus();
            $search.select();
          }
        }
      });
    },

    _select: function ($card) {
      var self = this;
      if (self.$current) {
        self.$current.removeClass(self.selectedClass);
      }
      self.$current = $card.addClass(self.selectedClass);

      // Ensure selected card is visible in viewport
      var offset = $card.offset();
      if (offset) {
        var scrollTop = $(window).scrollTop();
        var viewBottom = scrollTop + $(window).height();
        if (offset.top < scrollTop + 60 || offset.top > viewBottom - 60) {
          $('html, body').animate({ scrollTop: offset.top - 100 }, 150);
        }
      }
    }
  };

  /* =========================================================================
   * 8. SPRINT SELECTOR  (~60 lines)
   * =========================================================================*/
  var SprintSelector = {
    selector: '#rally-sprint-selector',

    init: function () {
      if (!$(this.selector).length) return;
      this._bindChange();
    },

    _bindChange: function () {
      var self = this;

      $(this.selector).on('change', function () {
        var sprintId = $(this).val();
        if (!sprintId) return;

        var $container = $('.rally-sprint-content, #content');
        if ($container.length) {
          $container.css({ opacity: 0.5 });
        }

        $.ajax($.extend(ajaxDefaults(), {
          url: '/rally/sprints/' + sprintId + '.json',
          method: 'GET',
          success: function (resp) {
            if (resp.html) {
              $container.html(resp.html);
            } else if (resp.content) {
              // If we get structured data, re-render the relevant sections
              self._updateContent(resp.content, $container);
            }
            $container.css({ opacity: 1 });

            // Update URL without page reload
            var url = '/sprints/' + sprintId;
            if (window.history && window.history.pushState) {
              window.history.pushState({ sprintId: sprintId }, 'Sprint ' + sprintId, url);
            }

            RallyToast.show('Switched to Sprint ' + sprintId, 'info');

            // Re-initialize features for new content
            RallyTheme.initFeatures();
          },
          error: function () {
            $container.css({ opacity: 1 });
            RallyToast.show('Failed to load sprint.', 'error');
          }
        }));
      });
    },

    _updateContent: function (content, $container) {
      // Update kanban if present
      if (content.columns) {
        var $board = $container.find('.rally-kanban-board');
        if ($board.length && content.columns_html) {
          $board.html(content.columns_html);
        }
      }
      // Update stats if present
      if (content.stats) {
        var $stats = $container.find('.rally-sprint-stats');
        if ($stats.length && content.stats_html) {
          $stats.html(content.stats_html);
        }
      }
    }
  };

  /* =========================================================================
   * 9. DASHBOARD CHART RENDERING  (~140 lines)
   * =========================================================================*/
  var DashboardCharts = {
    burndownSelector: '.rally-burndown-chart',
    velocitySelector: '.rally-velocity-chart',

    init: function () {
      var self = this;
      if ($(self.burndownSelector).length) self._drawBurndown();
      if ($(self.velocitySelector).length) self._drawVelocity();
    },

    // ── Burndown Chart (SVG) ───────────────────────────────────────────
    _drawBurndown: function () {
      var self = this;
      $(self.burndownSelector).each(function () {
        var $container = $(this);
        var dataStr = $container.attr('data-burndown');
        if (!dataStr) return;

        var data;
        try { data = JSON.parse(dataStr); } catch (e) { return; }

        var ideal = data.ideal || [];
        var actual = data.actual || [];
        var labels = data.labels || [];
        var width = $container.width() || 600;
        var height = Math.min(350, Math.max(200, width * 0.5));
        var pad = { top: 30, right: 30, bottom: 50, left: 60 };
        var chartW = width - pad.left - pad.right;
        var chartH = height - pad.top - pad.bottom;

        var maxVal = Math.max(
          Math.max.apply(null, ideal.concat(actual).map(Number)),
          1
        );

        // Build SVG
        var svg = self._createSVG(width, height);

        // Grid lines
        var gridCount = 5;
        for (var i = 0; i <= gridCount; i++) {
          var y = pad.top + (chartH / gridCount) * i;
          var val = Math.round(maxVal - (maxVal / gridCount) * i);
          svg += '<line x1="' + pad.left + '" y1="' + y + '" x2="' + (width - pad.right) + '" y2="' + y + '" stroke="#e5e7eb" stroke-width="1"/>';
          svg += '<text x="' + (pad.left - 10) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#6b7280">' + val + '</text>';
        }

        // X-axis labels
        var totalPoints = Math.max(ideal.length, actual.length, 1);
        for (var j = 0; j < labels.length; j++) {
          var x = pad.left + (chartW / (labels.length - 1 || 1)) * j;
          svg += '<text x="' + x + '" y="' + (height - pad.bottom + 20) + '" text-anchor="middle" font-size="11" fill="#6b7280">' + labels[j] + '</text>';
        }

        // Ideal line
        if (ideal.length > 1) {
          svg += self._polyline(ideal, pad, chartW, chartH, maxVal, '#9ca3af', 2, '5,5');
        }

        // Actual line
        if (actual.length > 1) {
          svg += self._polyline(actual, pad, chartW, chartH, maxVal, '#3b82f6', 2.5);
          // Area fill
          svg += self._areaFill(actual, pad, chartW, chartH, maxVal, 'rgba(59,130,246,0.08)');
        }

        // Dots on actual
        for (var k = 0; k < actual.length; k++) {
          var dx = pad.left + (chartW / (actual.length - 1 || 1)) * k;
          var dy = pad.top + chartH - (actual[k] / maxVal) * chartH;
          svg += '<circle cx="' + dx + '" cy="' + dy + '" r="4" fill="#3b82f6" stroke="#fff" stroke-width="2"/>';
        }

        // Title
        svg += '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="#374151">Sprint Burndown</text>';

        // Legend
        svg += '<line x1="' + (width - 200) + '" y1="14" x2="' + (width - 180) + '" y2="14" stroke="#9ca3af" stroke-width="2" stroke-dasharray="5,5"/>';
        svg += '<text x="' + (width - 175) + '" y="18" font-size="11" fill="#6b7280">Ideal</text>';
        svg += '<line x1="' + (width - 130) + '" y1="14" x2="' + (width - 110) + '" y2="14" stroke="#3b82f6" stroke-width="2.5"/>';
        svg += '<text x="' + (width - 105) + '" y="18" font-size="11" fill="#6b7280">Actual</text>';

        $container.html(svg);
      });
    },

    // ── Velocity Bar Chart (SVG) ───────────────────────────────────────
    _drawVelocity: function () {
      var self = this;
      $(self.velocitySelector).each(function () {
        var $container = $(this);
        var dataStr = $container.attr('data-velocity');
        if (!dataStr) return;

        var data;
        try { data = JSON.parse(dataStr); } catch (e) { return; }

        var sprints = data.sprints || [];
        var points = data.points || [];
        var committed = data.committed || [];

        var width = $container.width() || 600;
        var height = Math.min(300, Math.max(200, width * 0.45));
        var pad = { top: 30, right: 30, bottom: 50, left: 60 };
        var chartW = width - pad.left - pad.right;
        var chartH = height - pad.top - pad.bottom;

        var maxVal = Math.max(
          Math.max.apply(null, points.concat(committed).map(Number)),
          1
        );

        var svg = self._createSVG(width, height);
        var barGroupWidth = chartW / sprints.length;
        var barWidth = Math.min(40, barGroupWidth * 0.3);
        var gap = 4;

        // Grid
        var gridCount = 4;
        for (var g = 0; g <= gridCount; g++) {
          var gy = pad.top + (chartH / gridCount) * g;
          var gval = Math.round(maxVal - (maxVal / gridCount) * g);
          svg += '<line x1="' + pad.left + '" y1="' + gy + '" x2="' + (width - pad.right) + '" y2="' + gy + '" stroke="#e5e7eb" stroke-width="1"/>';
          svg += '<text x="' + (pad.left - 10) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="11" fill="#6b7280">' + gval + '</text>';
        }

        // Bars
        for (var b = 0; b < sprints.length; b++) {
          var groupX = pad.left + barGroupWidth * b + barGroupWidth / 2;
          var commitH = (committed[b] / maxVal) * chartH;
          var actualH = (points[b] / maxVal) * chartH;

          // Committed bar
          svg += '<rect x="' + (groupX - barWidth - gap / 2) + '" y="' + (pad.top + chartH - commitH) + '" ' +
            'width="' + barWidth + '" height="' + commitH + '" rx="3" fill="#93c5fd" stroke="#3b82f6" stroke-width="1" opacity="0.8"/>';

          // Actual bar
          svg += '<rect x="' + (groupX + gap / 2) + '" y="' + (pad.top + chartH - actualH) + '" ' +
            'width="' + barWidth + '" height="' + actualH + '" rx="3" fill="#3b82f6" stroke="#2563eb" stroke-width="1"/>';

          // Value labels on bars
          if (committed[b] > 0) {
            svg += '<text x="' + (groupX - barWidth / 2 - gap / 2) + '" y="' + (pad.top + chartH - commitH - 5) + '" ' +
              'text-anchor="middle" font-size="11" font-weight="600" fill="#1e40af">' + committed[b] + '</text>';
          }
          if (points[b] > 0) {
            svg += '<text x="' + (groupX + barWidth / 2 + gap / 2) + '" y="' + (pad.top + chartH - actualH - 5) + '" ' +
              'text-anchor="middle" font-size="11" font-weight="600" fill="#1e40af">' + points[b] + '</text>';
          }

          // Sprint label
          svg += '<text x="' + groupX + '" y="' + (height - pad.bottom + 18) + '" text-anchor="middle" font-size="11" fill="#6b7280">' + sprints[b] + '</text>';
        }

        // Title
        svg += '<text x="' + (width / 2) + '" y="18" text-anchor="middle" font-size="14" font-weight="600" fill="#374151">Velocity</text>';

        // Legend
        svg += '<rect x="' + (width - 230) + '" y="6" width="12" height="12" rx="2" fill="#93c5fd" stroke="#3b82f6" stroke-width="1"/>';
        svg += '<text x="' + (width - 213) + '" y="17" font-size="11" fill="#6b7280">Committed</text>';
        svg += '<rect x="' + (width - 140) + '" y="6" width="12" height="12" rx="2" fill="#3b82f6" stroke="#2563eb" stroke-width="1"/>';
        svg += '<text x="' + (width - 123) + '" y="17" font-size="11" fill="#6b7280">Completed</text>';

        $container.html(svg);
      });
    },

    // ── SVG helpers ────────────────────────────────────────────────────
    _createSVG: function (width, height) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" ' +
        'viewBox="0 0 ' + width + ' ' + height + '" style="max-width:100%;height:auto;">' +
        '<rect width="100%" height="100%" fill="#fff" rx="8"/>';
    },

    _polyline: function (points, pad, chartW, chartH, maxVal, color, width, dashArray) {
      var pts = [];
      var step = points.length > 1 ? chartW / (points.length - 1) : 0;
      for (var i = 0; i < points.length; i++) {
        var x = pad.left + step * i;
        var y = pad.top + chartH - (points[i] / maxVal) * chartH;
        pts.push(x + ',' + y);
      }
      var attrs = 'points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="' + width + '" stroke-linejoin="round" stroke-linecap="round"';
      if (dashArray) attrs += ' stroke-dasharray="' + dashArray + '"';
      return '<polyline ' + attrs + '/>';
    },

    _areaFill: function (points, pad, chartW, chartH, maxVal, fillColor) {
      var step = points.length > 1 ? chartW / (points.length - 1) : 0;
      var firstX = pad.left;
      var lastX = pad.left + step * (points.length - 1);
      var baseline = pad.top + chartH;

      var pathD = 'M ' + firstX + ',' + baseline;
      for (var i = 0; i < points.length; i++) {
        var x = pad.left + step * i;
        var y = pad.top + chartH - (points[i] / maxVal) * chartH;
        pathD += ' L ' + x + ',' + y;
      }
      pathD += ' L ' + lastX + ',' + baseline + ' Z';

      return '<path d="' + pathD + '" fill="' + fillColor + '"/>';
    }
  };

  /* =========================================================================
   * 10. THEME INITIALIZATION  (~60 lines)
   * =========================================================================*/
  var RallyTheme = {
    page: null,

    init: function () {
      this.page = currentPage();
      this._setupGlobalAjax();
      RallyToast.init();

      // Initialize features based on current page
      this.initFeatures();

      // Re-init charts on window resize (debounced)
      var resizeTimer;
      $(window).on('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          DashboardCharts.init();
        }, 300);
      });

      // Handle browser back/forward for sprint selector
      $(window).on('popstate', function (e) {
        if (e.originalEvent && e.originalEvent.state && e.originalEvent.state.sprintId) {
          var $selector = $(SprintSelector.selector);
          if ($selector.length) {
            $selector.val(e.originalEvent.state.sprintId);
            // Reload content for this sprint
            $selector.trigger('change');
          }
        }
      });
    },

    initFeatures: function () {
      // Always available
      CollapsiblePanels.init();
      QuickAdd.init();
      KeyboardNav.init();

      // Page-specific
      switch (this.page) {
        case 'kanban':
          KanbanBoard.init();
          break;
        case 'backlog':
          BacklogRanking.init();
          break;
        case 'dashboard':
          DashboardCharts.init();
          break;
        case 'sprint':
          KanbanBoard.init();
          SprintSelector.init();
          DashboardCharts.init();
          break;
        case 'issues':
          InlineEditing.init();
          KeyboardNav.init();
          break;
        default:
          // Try to initialize whatever we find on the page
          KanbanBoard.init();
          BacklogRanking.init();
          InlineEditing.init();
          DashboardCharts.init();
          SprintSelector.init();
          break;
      }
    },

    _setupGlobalAjax: function () {
      // Global AJAX error handler
      $(document).ajaxError(function (event, xhr, settings, thrownError) {
        // Only show toast for non-GET requests that fail unexpectedly
        if (settings.type && settings.type.toUpperCase() !== 'GET') {
          // Don't double-toast if the local handler already showed one
          if (!xhr._rallyHandled) {
            var msg = 'An unexpected error occurred.';
            if (xhr.status === 401) {
              msg = 'Session expired. Please log in again.';
            } else if (xhr.status === 403) {
              msg = 'You do not have permission for this action.';
            } else if (xhr.status === 422) {
              // Validation errors — likely handled locally
              return;
            }
            RallyToast.show(msg, 'error');
          }
        }
      });

      // Global AJAX complete — hide any lingering spinners
      $(document).ajaxComplete(function () {
        // Could be extended for global loading state
      });
    }
  };

  // ── Bootstrap on document ready ─────────────────────────────────────────
  $(document).ready(function () {
    RallyTheme.init();
  });

  // Expose globally for debugging / external use
  window.RallyTheme = RallyTheme;
  window.RallyToast = RallyToast;
  window.KanbanBoard = KanbanBoard;
  window.BacklogRanking = BacklogRanking;
  window.InlineEditing = InlineEditing;
  window.QuickAdd = QuickAdd;
  window.CollapsiblePanels = CollapsiblePanels;
  window.KeyboardNav = KeyboardNav;
  window.SprintSelector = SprintSelector;
  window.DashboardCharts = DashboardCharts;

})(jQuery);