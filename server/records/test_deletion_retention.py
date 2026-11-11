"""CR-110 item 3: the deletion message states the real backup retention of the hosted database."""
import unittest

from server.api import views


class DeletionRetentionMessage(unittest.TestCase):
    def test_cp32_the_message_names_the_seven_day_backup_window(self):
        self.assertIn('7 days', views.RETENTION)
        self.assertIn('backup', views.RETENTION)

    def test_cp32_the_message_no_longer_claims_there_are_no_backups(self):
        self.assertNotIn('configures no database backups', views.RETENTION)


if __name__ == '__main__':
    unittest.main()
