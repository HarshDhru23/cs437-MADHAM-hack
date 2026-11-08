from django.urls import path, re_path
from server.api import views

urlpatterns = [
    path('api/v1/health', views.health),
    path('api/v1/session', views.session),
    path('api/v1/auth/<str:action>', views.auth),
    path('api/v1/record', views.record),
    path('api/v1/plans', views.plans),
    path('api/v1/plans/<uuid:plan_id>', views.plan_detail),
    path('api/v1/imports/preview', views.import_preview),
    path('api/v1/imports/backup-preview', views.backup_preview),
    path('api/v1/imports/<uuid:preview_id>/commit', views.import_commit),
    path('api/v1/curricula/cse-2024', views.curriculum),
    path('api/v1/catalogue', views.catalogue),
    path('api/v1/analysis', views.analysis),
    path('api/v1/plans/<uuid:plan_id>/validate', views.plan_validate),
    path('api/v1/offerings', views.offerings),
    path('api/v1/calendar', views.calendar),
    path('api/v1/export', views.export),
    path('api/v1/account/data', views.account_data),
    path('api/v1/scenarios', views.scenarios),
    path('api/v1/scenarios/compare', views.scenarios_compare),
    path('api/v1/scenarios/<uuid:scenario_id>', views.scenario_detail),
    path('api/v1/scenarios/<uuid:scenario_id>/apply-plan', views.scenario_apply),
    re_path(r'^(?!api/|assets/).*$', views.spa),  # deep links such as /plan/<id> load the React app; registered after every API route
]
