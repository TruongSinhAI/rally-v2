class RallyController < ApplicationController
  layout 'base'
  before_action :find_project_by_project_id, :authorize
  before_action :set_rally_authorization, only: [:update_status, :update_rank, :create_sprint]
  accept_api_auth :kanban, :backlog, :sprints, :dashboard, :update_status, :update_rank, :create_sprint

  # ---------------------------------------------------------------------------
  # Kanban Board
  # ---------------------------------------------------------------------------
  def kanban
    respond_to do |format|
      format.html do
        @statuses = @project.issue_statuses.order(:position)
        @sprints = @project.versions.sorted
        @selected_sprint = params[:sprint_id].present? ? @project.versions.where(id: params[:sprint_id]).first : nil

        scope = @project.issues.visible
        scope = scope.where(fixed_version_id: @selected_sprint.id) if @selected_sprint

        if params[:assignee_id].present?
          scope = scope.where(assigned_to_id: params[:assignee_id])
        end
        if params[:tracker_id].present?
          scope = scope.where(tracker_id: params[:tracker_id])
        end
        if params[:priority_id].present?
          scope = scope.where(priority_id: params[:priority_id])
        end

        @issues_by_status = {}
        @statuses.each do |status|
          @issues_by_status[status.id] = scope.where(status_id: status.id)
                                                    .includes(:assigned_to, :tracker, :priority)
                                                    .order("#{Issue.table_name}.position ASC, #{Issue.table_name}.id ASC")
                                                    .to_a
        end

        @assignees = @project.memberships.includes(:user).map(&:user).compact.sort_by(&:name)
        @trackers = @project.trackers.sorted
        @priorities = IssuePriority.active.sorted
      end
      format.json do
        statuses = @project.issue_statuses.order(:position)
        issues = @project.issues.visible.includes(:status, :assigned_to, :tracker, :priority).order(:position)
        render json: { statuses: statuses.as_json(only: [:id, :name]),
                       issues: issues.as_json(only: [:id, :subject, :status_id, :assigned_to_id, :tracker_id, :priority_id, :position]) }
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Backlog
  # ---------------------------------------------------------------------------
  def backlog
    respond_to do |format|
      format.html do
        @trackers = @project.trackers.sorted
        @statuses = @project.issue_statuses.order(:position)
        @priorities = IssuePriority.active.sorted

        scope = @project.issues.visible
        scope = scope.where(parent_id: nil) if params[:hierarchical].nil? || params[:hierarchical] != 'flat'
        scope = scope.where(fixed_version_id: nil)

        if params[:search].present?
          scope = scope.where("#{Issue.table_name}.subject LIKE ?", "%#{params[:search].strip}%")
        end
        if params[:status_id].present?
          scope = scope.where(status_id: params[:status_id])
        end
        if params[:tracker_id].present?
          scope = scope.where(tracker_id: params[:tracker_id])
        end

        @backlog_issues = scope.includes(:assigned_to, :tracker, :priority, :status, :children)
                               .order("#{Issue.table_name}.position ASC, #{IssuePriority.table_name}.position DESC, #{Issue.table_name}.id ASC")
                               .to_a

        @total_points = @backlog_issues.sum { |i| (i.custom_field_value(CustomField.find_by(name: 'Story Points')) || 0).to_f rescue 0.0 }
        @new_issue = Issue.new(project: @project, tracker: @trackers.first)
      end
      format.json do
        issues = @project.issues.visible.where(fixed_version_id: nil)
                                .includes(:assigned_to, :tracker, :priority, :status, :children)
                                .order(:position)
        render json: issues.as_json(include: { children: { only: [:id, :subject, :status_id, :position] } })
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Sprints
  # ---------------------------------------------------------------------------
  def sprints
    respond_to do |format|
      format.html do
        @all_sprints = @project.versions.sorted
        @selected_sprint = if params[:sprint_id].present?
                             @project.versions.where(id: params[:sprint_id]).first
                           else
                             @all_sprints.where(["#{Version.table_name}.effective_date >= ?", Date.today]).first || @all_sprints.last
                           end

        if @selected_sprint
          @sprint_issues = @selected_sprint.fixed_issues.visible
                                               .includes(:assigned_to, :tracker, :priority, :status)
                                               .order("#{Issue.table_name}.position ASC, #{IssuePriority.table_name}.position DESC")
                                               .to_a

          total = @sprint_issues.size
          done_statuses = IssueStatus.where(is_closed: true).pluck(:id)
          done_count = @sprint_issues.count { |i| done_statuses.include?(i.status_id) }
          @sprint_progress = total > 0 ? ((done_count.to_f / total) * 100).round(1) : 0.0
          @sprint_done_count = done_count
          @sprint_total_count = total

          @velocity_data = calculate_velocity(@all_sprints)
          @members = @project.memberships.includes(:user, :roles).map(&:user).compact.uniq
        else
          @sprint_issues = []
          @sprint_progress = 0.0
          @sprint_done_count = 0
          @sprint_total_count = 0
          @velocity_data = []
          @members = []
        end
      end
      format.json do
        sprints = @project.versions.sorted.includes(:fixed_issues)
        render json: sprints.as_json(only: [:id, :name, :description, :effective_date, :created_on])
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Dashboard
  # ---------------------------------------------------------------------------
  def dashboard
    respond_to do |format|
      format.html do
        @total_issues = @project.issues.visible.count
        @open_issues = @project.issues.visible.where(closed_on: nil).count
        @closed_issues = @project.issues.visible.where.not(closed_on: nil).count

        @sprints = @project.versions.sorted
        @current_sprint = @sprints.where(["#{Version.table_name}.effective_date >= ?", Date.today]).first
        @members = @project.memberships.includes(:user).map(&:user).compact.uniq

        closed_this_sprint = 0
        if @current_sprint
          closed_statuses = IssueStatus.where(is_closed: true).pluck(:id)
          closed_this_sprint = @current_sprint.fixed_issues.visible
                                                     .where(status_id: closed_statuses)
                                                     .where(["#{Journal.table_name}.created_on >= ?", 30.days.ago])
                                                     .joins(:journals)
                                                     .distinct
                                                     .count
        end
        @closed_this_sprint = closed_this_sprint

        @velocity = calculate_velocity(@sprints)
        @avg_velocity = @velocity.present? ? (@velocity.sum { |v| v[:points] }.to_f / @velocity.size).round(1) : 0.0

        @recent_activity = @project.journals
                                   .includes(:user, :details)
                                   .where(["#{Journal.table_name}.created_on >= ?", 7.days.ago])
                                   .order("#{Journal.table_name}.created_on DESC")
                                   .limit(20)
                                   .to_a

        @upcoming_deadlines = @project.issues.visible
                                             .where(["#{Issue.table_name}.due_date IS NOT NULL AND #{Issue.table_name}.due_date >= ? AND #{Issue.table_name}.closed_on IS NULL", Date.today])
                                             .order("#{Issue.table_name}.due_date ASC")
                                             .limit(10)
                                             .to_a

        @sprint_progress = 0.0
        if @current_sprint
          total = @current_sprint.fixed_issues.visible.count
          done = @current_sprint.fixed_issues.visible
                                          .joins(:status)
                                          .where(["#{IssueStatus.table_name}.is_closed = ?", true])
                                          .count
          @sprint_progress = total > 0 ? ((done.to_f / total) * 100).round(1) : 0.0
        end

        @burndown_data = generate_burndown_data(@current_sprint) if @current_sprint
        @burndown_data ||= []
      end
      format.json do
        render json: {
          total_issues: @project.issues.visible.count,
          open_issues: @project.issues.visible.where(closed_on: nil).count,
          closed_issues: @project.issues.visible.where.not(closed_on: nil).count
        }
      end
    end
  end

  # ---------------------------------------------------------------------------
  # AJAX: Update Issue Status (Kanban drag-drop)
  # ---------------------------------------------------------------------------
  def update_status
    issue = @project.issues.visible.find_by(id: params[:issue_id])
    if issue.nil?
      render json: { error: l(:notice_not_found) }, status: :not_found
      return
    end

    new_status = IssueStatus.find_by(id: params[:new_status_id])
    if new_status.nil?
      render json: { error: 'Invalid status' }, status: :unprocessable_entity
      return
    end

    issue.init_journal(User.current)
    issue.status = new_status

    if new_status.is_closed?
      issue.closed_on = Time.now
    elsif issue.closed_on.present?
      issue.closed_on = nil
    end

    if issue.save
      render json: {
        success: true,
        issue_id: issue.id,
        new_status: new_status.name,
        new_status_id: new_status.id,
        message: "#{l(:rally_kanban_status_changed_to)} #{new_status.name}"
      }
    else
      render json: { error: issue.errors.full_messages.join(', ') }, status: :unprocessable_entity
    end
  end

  # ---------------------------------------------------------------------------
  # AJAX: Update Rank (reorder issues)
  # ---------------------------------------------------------------------------
  def update_rank
    ordered_ids = params[:ordered_issue_ids]
    if ordered_ids.blank? || !ordered_ids.is_a?(Array)
      render json: { error: 'No issue IDs provided' }, status: :bad_request
      return
    end

    ActiveRecord::Base.transaction do
      ordered_ids.each_with_index do |id, index|
        issue = @project.issues.visible.find_by(id: id)
        next if issue.nil?
        issue.update_column(:position, index + 1)
      end
    end

    render json: { success: true, message: l(:rally_kanban_rank_updated) }
  rescue StandardError => e
    render json: { error: "#{l(:rally_kanban_rank_failed)}: #{e.message}" }, status: :internal_server_error
  end

  # ---------------------------------------------------------------------------
  # AJAX: Create Sprint (Version)
  # ---------------------------------------------------------------------------
  def create_sprint
    name = params[:sprint_name].to_s.strip
    if name.blank?
      render json: { error: l(:rally_sprints_sprint_name) + ' is required' }, status: :unprocessable_entity
      return
    end

    start_date = parse_date_param(params[:start_date])
    end_date = parse_date_param(params[:end_date])

    version = Version.new(
      project: @project,
      name: name,
      description: params[:sprint_description].to_s,
      effective_date: end_date,
      start_date: start_date,
      status: 'open'
    )

    if version.save
      render json: {
        success: true,
        sprint: { id: version.id, name: version.name, start_date: version.start_date, end_date: version.effective_date },
        message: l(:rally_sprints_sprint_created)
      }
    else
      render json: { error: version.errors.full_messages.join(', ') }, status: :unprocessable_entity
    end
  end

  private

  # Ensure user has manage_rally permission for write actions
  def set_rally_authorization
    unless User.current.allowed_to?(:manage_rally, @project)
      render json: { error: l(:notice_not_authorized) }, status: :forbidden
    end
  end

  # Calculate velocity (points completed per sprint) for the last N sprints
  def calculate_velocity(sprints, limit: 6)
    return [] if sprints.blank?

    closed_status_ids = IssueStatus.where(is_closed: true).pluck(:id)
    sp_field = CustomField.find_by(name: 'Story Points')

    sprints.last(limit).map do |sprint|
      issues = sprint.fixed_issues.visible
      done_count = issues.where(status_id: closed_status_ids).count
      total_count = issues.count

      points = if sp_field
                 issues.where(status_id: closed_status_ids)
                       .joins(:custom_values)
                       .where("#{CustomValue.table_name}.custom_field_id = ?", sp_field.id)
                       .sum("#{CustomValue.table_name}.value").to_f
               else
                 0.0
               end

      { name: sprint.name, points: points, done_count: done_count, total_count: total_count, end_date: sprint.effective_date }
    end
  end

  # Generate simple burndown data points for a sprint
  def generate_burndown_data(sprint)
    return [] if sprint.nil? || sprint.effective_date.nil?

    start = sprint.start_date || (sprint.effective_date - 14.days)
    finish = sprint.effective_date
    total_scope = sprint.fixed_issues.visible.count
    closed_status_ids = IssueStatus.where(is_closed: true).pluck(:id)

    data = []
    (start..finish).each do |day|
      done_by_day = sprint.fixed_issues.visible
                                   .where(status_id: closed_status_ids)
                                   .where(["#{Journal.table_name}.created_on <= ?", day.end_of_day])
                                   .joins(:journals)
                                   .distinct
                                   .count
      data << { date: day.to_s(:db), remaining: [total_scope - done_by_day, 0].max }
    end
    data
  end

  # Parse a date string into a Date object
  def parse_date_param(date_string)
    return nil if date_string.blank?
    Date.parse(date_string) rescue nil
  end
end