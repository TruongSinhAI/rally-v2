/* ==========================================================================
   Rally Kanban - Drag & Drop Engine
   Depends: jQuery, jQuery UI Sortable
   ========================================================================== */

(function($) {
  'use strict';

  // -------------------------------------------------------------------------
  // Toast Notification System
  // -------------------------------------------------------------------------
  var RallyToast = {
    container: null,

    init: function() {
      if (this.container) return;
      this.container = $('<div class="rally-toast-container"></div>');
      $('body').append(this.container);
    },

    show: function(message, type, duration) {
      this.init();
      type = type || 'info';
      duration = duration || 4000;

      var icons = {
        success: '\u2713',
        error: '\u2717',
        warning: '\u26A0',
        info: '\u2139'
      };

      var $toast = $(
        '<div class="rally-toast toast-' + type + '">' +
          '<span class="rally-toast-icon">' + (icons[type] || icons.info) + '</span>' +
          '<span class="rally-toast-message">' + message + '</span>' +
          '<button class="rally-toast-close">&times;</button>' +
        '</div>'
      );

      this.container.append($toast);

      $toast.find('.rally-toast-close').on('click', function() {
        RallyToast.dismiss($toast);
      });

      setTimeout(function() {
        RallyToast.dismiss($toast);
      }, duration);

      return $toast;
    },

    dismiss: function($toast) {
      if (!$toast || $toast.hasClass('toast-exit')) return;
      $toast.addClass('toast-exit');
      setTimeout(function() {
        $toast.remove();
      }, 300);
    }
  };

  // -------------------------------------------------------------------------
  // CSRF Token Helper
  // -------------------------------------------------------------------------
  function getCSRFToken() {
    var meta = $('meta[name="csrf-token"]');
    return meta.length ? meta.attr('content') : '';
  }

  function csrfHeaders() {
    return {
      'X-CSRF-Token': getCSRFToken(),
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  // -------------------------------------------------------------------------
  // Utility: Update column count badges
  // -------------------------------------------------------------------------
  function updateColumnBadges() {
    $('.kanban-column').each(function() {
      var $col = $(this);
      var cardCount = $col.find('.kanban-card').length;
      var $badge = $col.find('.kanban-count-badge');
      var wipLimit = parseInt($col.data('wip-limit'), 10) || 0;

      $badge.text(cardCount);
      $badge.removeClass('wip-exceeded');
      $col.find('.kanban-wip-limit').removeClass('exceeded');

      if (wipLimit > 0 && cardCount > wipLimit) {
        $badge.addClass('wip-exceeded');
        $col.find('.kanban-wip-limit').addClass('exceeded');
      }
    });
  }

  // -------------------------------------------------------------------------
  // Utility: Determine priority class from card data
  // -------------------------------------------------------------------------
  function getPriorityClass(priorityName) {
    if (!priorityName) return 'priority-normal';
    var lower = priorityName.toLowerCase();
    if (lower.indexOf('immediate') !== -1 || lower.indexOf('urgent') !== -1) return 'priority-immediate';
    if (lower.indexOf('high') !== -1) return 'priority-high';
    if (lower.indexOf('low') !== -1) return 'priority-low';
    return 'priority-normal';
  }

  // -------------------------------------------------------------------------
  // Utility: Determine tracker type class
  // -------------------------------------------------------------------------
  function getTrackerTypeClass(trackerName) {
    if (!trackerName) return 'story';
    var lower = trackerName.toLowerCase();
    if (lower.indexOf('bug') !== -1 || lower.indexOf('defect') !== -1) return 'defect';
    if (lower.indexOf('task') !== -1 || lower.indexOf('chore') !== -1) return 'task';
    if (lower.indexOf('feature') !== -1) return 'feature';
    return 'story';
  }

  // -------------------------------------------------------------------------
  // Kanban DnD Engine
  // -------------------------------------------------------------------------
  var RallyKanban = {
    options: {
      connectWith: '.cards-container',
      placeholder: 'ui-sortable-placeholder',
      tolerance: 'pointer',
      cursor: 'grabbing',
      opacity: 0.85,
      revert: 150,
      scrollSensitivity: 60,
      scrollSpeed: 20,
      delay: 100,
      distance: 5,
      zIndex: 1000,
      items: '.kanban-card',
      handle: '.kanban-card',
      appendTo: 'body',
      helper: 'clone',
      forcePlaceholderSize: true,
      updateStatusUrl: null,
      updateRankUrl: null,
      touchDelay: 150
    },

    init: function(opts) {
      if (typeof opts === 'object') {
        $.extend(this.options, opts);
      }

      this.options.updateStatusUrl = this.options.updateStatusUrl || $('.rally-kanban-board').data('update-status-url');
      this.options.updateRankUrl = this.options.updateRankUrl || $('.rally-kanban-board').data('update-rank-url');

      this.bindSortable();
      this.bindQuickAdd();
      this.bindSprintSelector();
      this.bindFilterBar();
      updateColumnBadges();

      RallyToast.init();
    },

    // -----------------------------------------------------------------------
    // Bind jQuery UI Sortable to all kanban columns
    // -----------------------------------------------------------------------
    bindSortable: function() {
      var self = this;

      $('.cards-container').sortable(
        $.extend({}, self.options, {
          start: function(event, ui) {
            ui.placeholder.height(ui.item.outerHeight());
            ui.item.addClass('ui-draggable-dragging');
            $(this).closest('.kanban-column').addClass('drag-over');
          },

          over: function(event, ui) {
            $(this).closest('.kanban-column').addClass('drag-over');
          },

          out: function(event, ui) {
            $(this).closest('.kanban-column').removeClass('drag-over');
          },

          stop: function(event, ui) {
            ui.item.removeClass('ui-draggable-dragging');
            $('.kanban-column').removeClass('drag-over');
          },

          receive: function(event, ui) {
            var $card = ui.item;
            var $targetColumn = $(this).closest('.kanban-column');
            var newStatusId = $targetColumn.data('status-id');
            var issueId = $card.data('issue-id');

            if (!issueId || !newStatusId) return;

            self.updateIssueStatus(issueId, newStatusId, $card, $targetColumn);
          },

          update: function(event, ui) {
            if (ui.sender) {
              var $sourceContainer = ui.sender;
              self.reorderColumn($sourceContainer);
            }
            self.reorderColumn($(this));
          }
        })
      );

      // Touch support: enable sortable with touch-punch if available
      if (typeof $.ui !== 'undefined' && !$.ui.sortable.prototype._isOverAxis) {
        // Basic touch event translation for jQuery UI
        this.enableTouchSupport();
      }
    },

    // -----------------------------------------------------------------------
    // Update issue status via AJAX
    // -----------------------------------------------------------------------
    updateIssueStatus: function(issueId, newStatusId, $card, $column) {
      var self = this;

      $.ajax({
        url: self.options.updateStatusUrl,
        method: 'POST',
        headers: csrfHeaders(),
        data: JSON.stringify({
          issue_id: issueId,
          new_status_id: newStatusId
        }),
        success: function(response) {
          if (response.success) {
            var statusName = response.new_status || 'Updated';
            RallyToast.show(statusName, 'success', 3000);
            $card.attr('data-status-id', newStatusId);
          } else {
            RallyToast.show(response.error || 'Unknown error', 'error', 5000);
            $card.detach().appendTo($card.data('original-column') || '.cards-container:first');
          }
        },
        error: function(xhr) {
          var errorMsg = 'Failed to update status';
          try {
            var resp = JSON.parse(xhr.responseText);
            errorMsg = resp.error || errorMsg;
          } catch(e) {
            // use default message
          }
          RallyToast.show(errorMsg, 'error', 5000);
          $card.detach().appendTo($card.data('original-column') || '.cards-container:first');
        }
      });
    },

    // -----------------------------------------------------------------------
    // Reorder cards within a column and persist rank
    // -----------------------------------------------------------------------
    reorderColumn: function($container) {
      var self = this;
      var orderedIds = [];

      $container.find('.kanban-card').each(function() {
        orderedIds.push($(this).data('issue-id'));
      });

      if (orderedIds.length === 0 || !self.options.updateRankUrl) return;

      $.ajax({
        url: self.options.updateRankUrl,
        method: 'POST',
        headers: csrfHeaders(),
        data: JSON.stringify({
          ordered_issue_ids: orderedIds
        }),
        success: function(response) {
          if (response.success) {
            // Silently update; optionally show toast for reorder confirmation
          }
        },
        error: function() {
          RallyToast.show('Rank update failed', 'warning', 3000);
        }
      });

      updateColumnBadges();
    },

    // -----------------------------------------------------------------------
    // Quick-add form toggle
    // -----------------------------------------------------------------------
    bindQuickAdd: function() {
      var self = this;

      $(document).on('click', '.rally-quick-add-btn', function(e) {
        e.preventDefault();
        var $btn = $(this);
        var $form = $btn.siblings('.rally-quick-add-form');
        if ($form.length) {
          $btn.hide();
          $form.slideDown(150);
          $form.find('input[type="text"]').focus();
        }
      });

      $(document).on('click', '.rally-quick-add-form .btn-cancel', function(e) {
        e.preventDefault();
        var $form = $(this).closest('.rally-quick-add-form');
        $form.slideUp(150);
        $form.siblings('.rally-quick-add-btn').show();
      });

      $(document).on('submit', '.rally-quick-add-form', function(e) {
        e.preventDefault();
        var $form = $(this);
        var $input = $form.find('input[name="subject"]');
        var subject = $.trim($input.val());

        if (!subject) {
          $input.css('border-color', '#ff5630');
          $input.focus();
          return;
        }

        var sprintId = $form.find('select[name="sprint_id"]').val();
        var trackerId = $form.find('select[name="tracker_id"]').val();
        var statusId = $form.closest('.kanban-column').data('status-id');
        var projectId = $form.data('project-id');

        $.ajax({
          url: '/issues.json',
          method: 'POST',
          headers: csrfHeaders(),
          data: JSON.stringify({
            issue: {
              project_id: projectId,
              subject: subject,
              tracker_id: trackerId,
              status_id: statusId,
              fixed_version_id: sprintId
            }
          }),
          success: function(response) {
            if (response && response.issue) {
              var issue = response.issue;
              var $newCard = self.buildCardElement(issue);
              $form.closest('.kanban-column').find('.cards-container').prepend($newCard);
              $form.slideUp(150, function() {
                $form.siblings('.rally-quick-add-btn').show();
                $form.find('input[type="text"]').val('').css('border-color', '');
              });
              RallyToast.show('Issue #' + issue.id + ' created', 'success', 3000);
              updateColumnBadges();
            }
          },
          error: function(xhr) {
            var msg = 'Failed to create issue';
            try {
              var r = JSON.parse(xhr.responseText);
              msg = (r.errors && r.errors.join(', ')) || msg;
            } catch(e) {}
            RallyToast.show(msg, 'error', 5000);
          }
        });
      });
    },

    // -----------------------------------------------------------------------
    // Build a card DOM element from issue data
    // -----------------------------------------------------------------------
    buildCardElement: function(issue) {
      var priorityClass = getPriorityClass(issue.priority ? issue.priority.name : '');
      var typeClass = getTrackerTypeClass(issue.tracker ? issue.tracker.name : '');
      var typeLabel = issue.tracker ? issue.tracker.name.charAt(0).toUpperCase() : 'S';
      var trackerName = issue.tracker ? issue.tracker.name : 'Story';
      var assigneeName = issue.assigned_to ? issue.assigned_to.name : '';
      var assigneeAvatar = issue.assigned_to ? issue.assigned_to.avatar_url || '' : '';

      var avatarHtml = '';
      if (assigneeAvatar) {
        avatarHtml = '<span class="kanban-card-assignee"><img src="' + assigneeAvatar + '" alt="' + assigneeName + '" title="' + assigneeName + '"></span>';
      } else if (assigneeName) {
        avatarHtml = '<span class="kanban-card-assignee" title="' + assigneeName + '">' + assigneeName.charAt(0) + '</span>';
      }

      var $card = $(
        '<div class="kanban-card ' + priorityClass + '" data-issue-id="' + issue.id + '" data-status-id="' + (issue.status ? issue.status.id : '') + '">' +
          '<div class="kanban-card-header">' +
            '<span class="kanban-card-id">#' + issue.id + '</span>' +
            '<span class="kanban-card-type-icon ' + typeClass + '" title="' + trackerName + '">' + typeLabel + '</span>' +
          '</div>' +
          '<div class="kanban-card-title">' + $('<span>').text(issue.subject).html() + '</div>' +
          '<div class="kanban-card-footer">' +
            '<div class="kanban-card-meta">' +
              avatarHtml +
            '</div>' +
          '</div>' +
        '</div>'
      );

      return $card;
    },

    // -----------------------------------------------------------------------
    // Sprint selector change handler
    // -----------------------------------------------------------------------
    bindSprintSelector: function() {
      $(document).on('change', '.rally-sprint-selector select', function() {
        var url = $(this).val();
        if (url) {
          window.location.href = url;
        }
      });
    },

    // -----------------------------------------------------------------------
    // Filter bar handlers
    // -----------------------------------------------------------------------
    bindFilterBar: function() {
      $(document).on('change', '.rally-filter-bar select', function() {
        $(this).closest('form').submit();
      });
    },

    // -----------------------------------------------------------------------
    // Touch support enhancement
    // -----------------------------------------------------------------------
    enableTouchSupport: function() {
      var touchTimer = null;
      var touchMoved = false;

      $(document).on('touchstart', '.kanban-card', function(e) {
        touchMoved = false;
        var self = this;
        touchTimer = setTimeout(function() {
          if (!touchMoved) {
            $(self).trigger('mousedown');
          }
        }, this.options.touchDelay || 150);
      });

      $(document).on('touchmove', '.kanban-card', function() {
        touchMoved = true;
        if (touchTimer) {
          clearTimeout(touchTimer);
          touchTimer = null;
        }
      });

      $(document).on('touchend', '.kanban-card', function() {
        if (touchTimer) {
          clearTimeout(touchTimer);
          touchTimer = null;
        }
      });
    }
  };

  // -------------------------------------------------------------------------
  // Backlog DnD (reorder)
  // -------------------------------------------------------------------------
  var RallyBacklog = {
    init: function(opts) {
      opts = opts || {};
      var updateRankUrl = opts.updateRankUrl || $('.rally-backlog-list').data('update-rank-url');

      $('.rally-backlog-list').sortable({
        handle: '.backlog-drag-handle',
        items: '.backlog-item.depth-0',
        tolerance: 'pointer',
        cursor: 'grabbing',
        opacity: 0.85,
        placeholder: 'ui-sortable-placeholder',
        update: function() {
          var orderedIds = [];
          $(this).find('.backlog-item.depth-0').each(function() {
            orderedIds.push($(this).data('issue-id'));
          });

          if (orderedIds.length > 0 && updateRankUrl) {
            $.ajax({
              url: updateRankUrl,
              method: 'POST',
              headers: csrfHeaders(),
              data: JSON.stringify({ ordered_issue_ids: orderedIds }),
              success: function(resp) {
                if (resp.success) {
                  RallyToast.init();
                  RallyToast.show('Rank updated', 'success', 2000);
                }
              },
              error: function() {
                RallyToast.init();
                RallyToast.show('Rank update failed', 'error', 3000);
              }
            });
          }
        }
      });
    },

    toggleAll: function(expand) {
      if (expand) {
        $('.backlog-children').slideDown(150);
        $('.backlog-toggle-icon').removeClass('collapsed');
      } else {
        $('.backlog-children').slideUp(150);
        $('.backlog-toggle-icon').addClass('collapsed');
      }
    }
  };

  // -------------------------------------------------------------------------
  // Sprint Panel collapse/expand
  // -------------------------------------------------------------------------
  var RallySprints = {
    init: function() {
      $(document).on('click', '.sprint-panel-header', function() {
        var $panel = $(this).closest('.sprint-panel');
        $panel.toggleClass('collapsed');
      });
    }
  };

  // -------------------------------------------------------------------------
  // Expose to global scope
  // -------------------------------------------------------------------------
  window.RallyKanban = RallyKanban;
  window.RallyBacklog = RallyBacklog;
  window.RallySprints = RallySprints;
  window.RallyToast = RallyToast;

  // -------------------------------------------------------------------------
  // Auto-initialize on DOM ready
  // -------------------------------------------------------------------------
  $(function() {
    if ($('.rally-kanban-board').length) {
      RallyKanban.init();
    }
    if ($('.rally-backlog-list').length) {
      RallyBacklog.init();
    }
    if ($('.sprint-panel').length) {
      RallySprints.init();
    }
  });

})(jQuery);