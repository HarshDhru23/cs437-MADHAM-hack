from dataclasses import FrozenInstanceError
from datetime import date
from decimal import Decimal
import unittest
from coursepath.models import CourseAttempt, Term
from coursepath.serialization import dumps, decimal_value
from coursepath.validation import plan_payload, current_enrolment


class ValidationTests(unittest.TestCase):
    def test_exact_decimals_dates_statuses_and_immutability(self):
        attempt = CourseAttempt('a', 'ZZ 100', 'ZZ100', 'Synthetic', Decimal('1.5000'), 'A', '2024-25-I', 'completed')
        self.assertIn('"credits": "1.5"', dumps(attempt))
        with self.assertRaises(FrozenInstanceError):
            attempt.grade = 'B'
        for value in ['NaN', 'Infinity', '-1', '0.12345', 1.5, True]:
            with self.assertRaises(ValueError):
                decimal_value(value)
        with self.assertRaises(ValueError):
            Term('2024-26-I')
        with self.assertRaises(ValueError):
            Term('2024-25-I', date(2024, 7, 1), date(2024, 7, 1))
        with self.assertRaises(ValueError):
            CourseAttempt('a', 'ZZ 100', 'ZZ100', 'Synthetic', Decimal(1), 'A', '2024-25-I', 'PLANNED')

    def test_invalid_nested_inputs_and_privileged_plan_fields(self):
        for payload in [{'semesters': [None]}, {'semesters': [{'term_id': '2024-25-I', 'courses': [None]}]},
                        {'semesters': [{'term_id': '2024-25-I', 'courses': [{'id': 'a', 'normalized_code': 'ZZ 100', 'credits': '1', 'verified': True}]}]},
                        {'owner_id': 'foreign', 'semesters': []}]:
            with self.assertRaises((ValueError, KeyError)):
                plan_payload(payload)
        with self.assertRaises(ValueError):
            current_enrolment([{'id': 'a', 'term_id': '2024-25-I', 'normalized_code': 'ZZ 100', 'credits': '4', 'confirmed': False}])
