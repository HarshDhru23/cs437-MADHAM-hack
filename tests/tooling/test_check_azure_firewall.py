"""CR-108: the deploy checklist step that fails while the database firewall admits all of Azure (a 0.0.0.0 rule). Uses fake `az` output."""
import contextlib
import io
import json
import sys
import unittest
from unittest import mock
from tests.tooling.test_scripts import load

CHECK = load('check_azure_firewall')
ALLOW_ALL = {'name': 'AllowAllAzureServicesAndResourcesWithinAzureIps_2026-11-7_10-0-0', 'startIpAddress': '0.0.0.0', 'endIpAddress': '0.0.0.0'}
APP = {'name': 'app-20.1.2.3', 'startIpAddress': '20.1.2.3', 'endIpAddress': '20.1.2.3'}
RANGE = {'name': 'office', 'startIpAddress': '10.0.0.1', 'endIpAddress': '10.0.0.9'}


def run(rules):
    out = io.StringIO()
    with mock.patch.object(sys, 'stdin', io.StringIO(json.dumps(rules))), contextlib.redirect_stdout(out):
        code = CHECK.main(['check_azure_firewall.py', '-'])
    return code, out.getvalue()


class AzureFirewallCheck(unittest.TestCase):
    def test_a_rule_admitting_all_of_azure_fails_and_is_named(self):
        code, text = run([ALLOW_ALL, APP])
        self.assertEqual(code, 1)
        self.assertIn('AllowAllAzureServicesAndResourcesWithinAzureIps', text)
        self.assertIn('FAIL', text)

    def test_specific_addresses_and_ranges_pass(self):
        # Negative: a range that merely starts or ends elsewhere is not "all of Azure".
        code, text = run([APP, RANGE])
        self.assertEqual(code, 0, text)
        self.assertIn('PASS', text)

    def test_an_end_address_of_zero_also_fails(self):
        self.assertEqual(run([{'name': 'odd', 'startIpAddress': '1.2.3.4', 'endIpAddress': '0.0.0.0'}])[0], 1)

    def test_an_empty_rule_list_passes(self):
        self.assertEqual(run([])[0], 0)

    def test_unreadable_input_is_not_a_pass(self):
        out = io.StringIO()
        with mock.patch.object(sys, 'stdin', io.StringIO('not json')), contextlib.redirect_stdout(out):
            self.assertEqual(CHECK.main(['check_azure_firewall.py', '-']), 2)
        self.assertIn('could not read', out.getvalue())

    def test_a_missing_az_command_is_not_a_pass(self):
        out = io.StringIO()
        with mock.patch.object(CHECK.subprocess, 'run', side_effect=FileNotFoundError('az')), contextlib.redirect_stdout(out):
            self.assertEqual(CHECK.main(['check_azure_firewall.py']), 2)


if __name__ == '__main__':
    unittest.main()
