from django.urls import path
from server.api import views

urlpatterns = [
    path('api/v1/session', views.session),
    path('api/v1/auth/<str:action>', views.auth),
    path('api/v1/record', views.record),
    path('api/v1/plans', views.plans),
    path('api/v1/plans/<uuid:plan_id>', views.plan_detail),
    path('api/v1/imports/preview', views.import_preview),
    path('api/v1/imports/<uuid:preview_id>/commit', views.import_commit),
    path('api/v1/curricula/cse-2024', views.curriculum),
    path('api/v1/catalogue', views.catalogue),
    path('api/v1/analysis', views.analysis),
    path('api/v1/plans/<uuid:plan_id>/validate', views.plan_validate),
    path('api/v1/offerings', views.offerings),
    path('api/v1/scenarios', views.scenarios),
    path('api/v1/scenarios/compare', views.scenarios_compare),
    path('api/v1/scenarios/<uuid:scenario_id>', views.scenario_detail),
    path('api/v1/scenarios/<uuid:scenario_id>/apply-plan', views.scenario_apply),
]
