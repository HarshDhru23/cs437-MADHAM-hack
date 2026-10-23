TYPES = {'mandatory_course', 'minimum_credits', 'choose_courses', 'approved_set', 'all_of', 'any_of', 'noncredit'}


def walk_requirements(requirements):
    for requirement in requirements:
        yield requirement
        yield from walk_requirements(requirement.get('children', []))
