from copy import deepcopy


def list_graduation_requirements(curriculum, academic_history=None):
    """Requirements are available independently of the student's history."""
    return deepcopy(curriculum.get('baskets', curriculum.get('requirements', [])))
