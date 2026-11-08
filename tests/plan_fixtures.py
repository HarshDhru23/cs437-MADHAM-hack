"""Synthetic records for plan-generation tests (D-35, CP-35). Public course codes, invented ids and grades; no private data.

SYNTHETIC_DONE is a student after four regular semesters. The remaining credits are counted by hand from the CSE 2024 table
(ADV13, docs/academic-decisions.md), not taken from the code under test:

    completed   foundation 4 (FP 100) + institute core 31 + materials 3 (ES 118)
                + HSS 20 (HS 191/192 4, HS 151/221/201 12, two GE courses 4) + math 10 + CSE core 20 (five of nine)
                + open project 4 (CS 299)                                                = 92
    remaining   HSS electives 8 + science basket 8 + BS elective 4 + CSE core 16 (CS 201, 330, 329, 331)
                + CSE electives 26 + open electives 16                                   = 78      (170 - 92)
"""
TERMS = ['2024-25-I', '2024-25-II', '2025-26-I', '2025-26-II']

# (code, credits, term index)
DONE = [
    ('FP 100', '4', 0), ('ES 101', '3', 0), ('ES 112', '3', 0), ('ES 113', '3', 0), ('ES 114', '3', 0), ('MA 103', '4', 0),
    ('ES 115', '5', 1), ('ES 116', '5', 1), ('ES 117', '2', 1), ('MA 104', '2', 1), ('HS 191', '2', 1), ('BS 192', '3', 1), ('ES 118', '3', 1),
    ('ES 243', '4', 2), ('HS 192', '2', 2), ('HS 151', '4', 2), ('MA 203', '2', 2), ('MA 205', '2', 2), ('ES 242', '4', 2), ('GE 101', '2', 2),
    ('ES 214', '4', 3), ('ES 204', '4', 3), ('ES 336', '4', 3), ('CS 202', '4', 3), ('HS 221', '4', 3), ('HS 201', '4', 3), ('GE 102', '2', 3),
    ('CS 299', '4', 3),
    ('PE 101', '0', 0), ('PE 102', '0', 1), ('PE 103', '0', 2), ('PE 104', '0', 3),
    ('IN 101', '0', 0), ('IN 102', '0', 1), ('IN 103', '0', 2), ('IN 104', '0', 3),   # the comprehensive viva record of each active semester (D-16)
]
CORE_PENDING = ['CS 201', 'CS 329', 'CS 330', 'CS 331']


def attempt(code, credits, term, grade='A', suffix=''):
    return {'id': f'syn-{term}-{code}{suffix}'.replace(' ', ''), 'source_key': f'syn-{term}-{code}{suffix}'.replace(' ', ''),
            'normalized_code': code, 'original_code': code, 'title': 'Synthetic ' + code, 'credits': credits, 'grade': grade,
            'term_id': term, 'completion_status': 'completed', 'learning_designation': 'degree', 'source_refs': [], 'user_corrections': []}


def synthetic_attempts(without=(), extra=()):
    rows = [attempt(code, credits, TERMS[term], 'P' if code.split()[0] in {'FP', 'GE', 'PE', 'IN'} else 'A') for code, credits, term in DONE if code not in without]
    return rows + list(extra)
