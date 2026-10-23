"""Describe available entry points without starting services implicitly."""


def main():
    print("CoursePath - 2024-entry CSE backend")
    print("Setup and API handoff: server/README.md and server/HANDOFF.md")
    print("Domain tests: python -m unittest discover -s tests -v")
    print("Database setup: python server/manage.py migrate")
    print("Backend: python server/manage.py runserver 127.0.0.1:8000")
    print("Academic sources are draft; frontend integration and review are pending.")


if __name__ == "__main__":
    main()
