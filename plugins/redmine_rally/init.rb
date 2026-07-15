Redmine::Plugin.register :redmine_rally do
  name 'Redmine Rally Theme'
  author 'TruongSinhAI'
  description 'Transforms Redmine UI to look like CA/Broadcom Rally'
  version '1.0.0'
  url 'https://github.com/TruongSinhAI/rally-v2'
  author_url 'https://github.com/TruongSinhAI'

  project_module :rally do
    permission :view_rally_kanban, {:rally => [:kanban]}, :read => true
    permission :view_rally_backlog, {:rally => [:backlog]}, :read => true
    permission :view_rally_sprints, {:rally => [:sprints]}, :read => true
    permission :view_rally_dashboard, {:rally => [:dashboard]}, :read => true
    permission :manage_rally, {:rally => [:update_status, :update_rank, :create_sprint]}, :require => :member
  end

  menu :project_menu, :rally_kanban, {:controller => 'rally', :action => 'kanban'}, :caption => 'Kanban', :after => :issues, :param => :project_id
  menu :project_menu, :rally_backlog, {:controller => 'rally', :action => 'backlog'}, :caption => 'Backlog', :after => :rally_kanban, :param => :project_id
  menu :project_menu, :rally_sprints, {:controller => 'rally', :action => 'sprints'}, :caption => 'Sprints', :after => :rally_backlog, :param => :project_id
  menu :project_menu, :rally_dashboard, {:controller => 'rally', :action => 'dashboard'}, :caption => 'Dashboard', :after => :rally_sprints, :param => :project_id
end