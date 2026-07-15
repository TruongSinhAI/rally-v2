RedmineApp::Application.routes.draw do
  resources :projects do
    member do
      get 'rally/kanban', :to => 'rally#kanban', :as => 'rally_kanban'
      get 'rally/backlog', :to => 'rally#backlog', :as => 'rally_backlog'
      get 'rally/sprints', :to => 'rally#sprints', :as => 'rally_sprints'
      get 'rally/dashboard', :to => 'rally#dashboard', :as => 'rally_dashboard'
      post 'rally/update_status', :to => 'rally#update_status', :as => 'rally_update_status'
      post 'rally/update_rank', :to => 'rally#update_rank', :as => 'rally_update_rank'
      post 'rally/create_sprint', :to => 'rally#create_sprint', :as => 'rally_create_sprint'
    end
  end
end