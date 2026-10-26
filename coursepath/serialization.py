import json
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation


def decimal_value(value):
    if isinstance(value, (float, bool)):
        raise ValueError('Use an exact decimal string, not float/bool')
    try:
        result = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError('Invalid decimal') from exc
    if not result.is_finite() or result < 0 or result > Decimal('10000'):
        raise ValueError('Decimal outside supported bounds')
    if result.as_tuple().exponent < -4:
        raise ValueError('At most four decimal places are supported; no rounding applied')
    return result


def decimal_string(value):
    result = format(value, 'f')
    return result.rstrip('0').rstrip('.') if '.' in result else result


def plain(value):
    if is_dataclass(value):
        value = asdict(value)
    if isinstance(value, Decimal):
        return decimal_string(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [plain(v) for v in value]
    return value


def dumps(value):
    return json.dumps(plain(value), ensure_ascii=False, allow_nan=False)
