from datetime import date


def validate_sources(sources, cohort, reviewed=False):
    ids = set()
    for source in sources:
        for field in ['id', 'locator', 'version', 'applicable_cohorts', 'review_status', 'authority']:
            if not source.get(field):
                raise ValueError('Missing source metadata: ' + field)
        if source['id'] in ids or cohort not in source['applicable_cohorts']:
            raise ValueError('Duplicate or cohort-inapplicable source')
        ids.add(source['id'])
        if source.get('effective_date'):
            date.fromisoformat(source['effective_date'])
        if reviewed and (source['review_status'] != 'reviewed' or source['authority'] != 'institutional' or not source.get('effective_date')):
            raise ValueError('Reviewed rules require applicable institutional evidence and effective dates')
    return ids
