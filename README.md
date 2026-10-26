# CoursePath

CoursePath will help IIT Gandhinagar B.Tech CSE students audit their graduation requirements and plan future semesters with checks they can independently verify. The named initial user is Aayush Kuloor; his feedback and the ten October 16 statements are in [SPEC.md](SPEC.md).

## Run

Install Python 3.10 or later, clone this repository, and open a terminal in its root. No third-party packages, database, credentials, or environment variables are needed for this checkpoint.

```sh
python -m coursepath
```

This launches the original October 9 scaffold and prints its historical status. The October 16 checkpoint expands the specification and tests; product implementation and the student-facing web interface belong to later milestones.

## Test

```sh
python -m unittest discover -s tests -v
```
On systems where Python is named `python3`, substitute `python3` in both commands.

For October 16, discovery runs 11 tests covering CP-01 through CP-10. All 11 are expected to fail with assertions because the features are unimplemented; the test command therefore exits with status 1. No tests should be skipped or fail to import. The new import tests use only the Python standard library to build synthetic input and report the missing implementation when run against this scaffold.

See [SPEC.md](SPEC.md) for the statement-to-test mapping and the remaining acceptance evidence.
