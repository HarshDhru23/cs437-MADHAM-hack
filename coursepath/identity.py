"""Course identity (docs/academic-decisions.md D-01 to D-04).

Old and variant codes resolve to the current course before requirements or
prerequisites are matched. The imported raw code stays on the record.
"""


def identity_map(groups):
    mapping = {}
    for group in groups or ():
        for code in [group['current'], *group['same']]:
            if mapping.get(code, group['current']) != group['current']:
                raise ValueError(f'{code} belongs to two identity groups')
            mapping[code] = group['current']
    return mapping


def canonical_code(code, mapping=None):
    return (mapping or {}).get(code, code)
