"""Stable, serializable issues shared by domain and HTTP boundaries."""
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Issue:
    code: str
    severity: str
    message: str
    entity_refs: tuple[str, ...] = ()
    source_refs: tuple[str, ...] = ()
    suggested_action: str = 'Review the source evidence.'

    def __post_init__(self):
        if self.severity not in {'error', 'warning', 'info', 'unknown', 'approval_required'}:
            raise ValueError('Invalid issue severity')

    def to_dict(self):
        result = asdict(self)
        result['entity_refs'] = list(self.entity_refs)
        result['source_refs'] = list(self.source_refs)
        return result


def issue(code, message, severity='unknown', entities=(), sources=(), action='Review the source evidence.'):
    return Issue(code, severity, message, tuple(entities), tuple(sources), action).to_dict()
