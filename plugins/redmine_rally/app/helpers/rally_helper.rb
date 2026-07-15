module RallyHelper
  # Returns a hex color string for a priority indicator dot
  def priority_dot_color(priority)
    return '#c1c7d0' if priority.nil?
    case priority.position
    when 1..2 then '#ff5630'   # Immediate/Urgent
    when 3..4 then '#ff991f'   # High
    when 5..6 then '#0065ff'   # Normal
    else          '#36b37e'   # Low
    end
  end

  # Returns the numeric story points value for an issue (from a custom field)
  def story_points_for(issue)
    return '' if issue.nil?
    field = CustomField.find_by(name: 'Story Points')
    return '' if field.nil?
    value = issue.custom_field_value(field.id)
    value.to_s.strip
  end

  # Returns a CSS-friendly class suffix for a status name
  def status_css_class(status)
    return 'new' if status.nil?
    name = status.name.downcase.gsub(/\s+/, '-')
    case name
    when 'new', 'open' then 'new'
    when 'in-progress', 'in progress', 'started' then 'in-progress'
    when 'done', 'closed', 'resolved', 'completed' then 'done'
    when 'blocked' then 'blocked'
    when 'feedback', 'needs-info', 'needs information' then 'in-progress'
    when 'rejected', 'canceled' then 'blocked'
    when 'ready', 'to-do', 'to do' then 'new'
    when 'testing', 'in-review', 'in review', 'qa' then 'in-progress'
    else name
    end
  end

  # Returns a CSS class for a deadline date (overdue, soon, or normal)
  def deadline_css_class(due_date)
    return '' if due_date.nil?
    days_left = (due_date - Date.today).to_i
    if days_left < 0
      'overdue'
    elsif days_left <= 3
      'soon'
    else
      ''
    end
  end
end