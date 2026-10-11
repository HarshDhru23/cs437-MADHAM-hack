# CoursePath

CoursePath will help IIT Gandhinagar B.Tech CSE students audit their graduation requirements and plan future semesters with checks they can independently verify. The named initial user is Aayush Kuloor; his feedback and the five initial requirements are in [SPEC.md](SPEC.md).

## Run

Install Python 3.10 or later, clone this repository, and open a terminal in its root. No third-party packages, database, credentials, or environment variables are needed for this checkpoint.

```sh
python -m coursepath
```

This launches the checkpoint scaffold and prints its status. It is not yet the student-facing web application; the web interface belongs to later milestones.

## Test

```sh
python -m unittest discover -s tests -v
```
On systems where Python is named `python3`, substitute `python3` in both commands.
