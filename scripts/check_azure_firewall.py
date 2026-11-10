"""Deploy checklist step (docs/operations/azure.md): fail if the database firewall admits all of Azure.

A firewall rule whose start or end address is 0.0.0.0 means "allow all Azure services and resources", including other customers' resources
(CR-108). Pipe the rule list in, or let the script ask the Azure CLI (read-only):

    az postgres flexible-server firewall-rule list --resource-group coursepath-rg --server-name coursepath-db-isc | python scripts/check_azure_firewall.py -
    python scripts/check_azure_firewall.py            # runs that `az` command itself

Exit code 0 when no rule admits all of Azure, 1 when one does, 2 when the list could not be read. Prints rule names and addresses only, never settings."""
import json
import subprocess
import sys

RESOURCE_GROUP = 'coursepath-rg'
SERVER = 'coursepath-db-isc'


def open_to_azure(rules):
    """The rules that admit every Azure-hosted resource: a start or an end address of 0.0.0.0."""
    return [rule for rule in rules if '0.0.0.0' in (rule.get('startIpAddress'), rule.get('endIpAddress'))]


def list_command():
    # `firewall-rule list` names the server with --server-name; --name is not accepted there (checked against the installed Azure CLI's help).
    return ['az', 'postgres', 'flexible-server', 'firewall-rule', 'list', '--resource-group', RESOURCE_GROUP, '--server-name', SERVER, '--output', 'json']


def read_rules(argument):
    if argument == '-':
        return json.load(sys.stdin)
    out = subprocess.run(list_command(), capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or 'az failed')
    return json.loads(out.stdout)


def main(argv):
    try:
        rules = read_rules(argv[1] if len(argv) > 1 else None)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'FAIL: could not read the firewall rules ({error})')
        return 2
    bad = open_to_azure(rules)
    for rule in bad:
        print(f"FAIL: rule {rule.get('name')} ({rule.get('startIpAddress')} - {rule.get('endIpAddress')}) admits every Azure service and resource")
    if bad:
        return 1
    print(f'PASS: {len(rules)} firewall rule(s), none admits all of Azure')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
