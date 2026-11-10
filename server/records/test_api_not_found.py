"""CR-110 item 6 (contract §envelope): an unknown API path answers with the same JSON envelope as every other API error, not an HTML 404."""
from django.test import Client, TestCase
from server.records.testing import AccountAPIMixin


class UnknownApiPathTests(AccountAPIMixin, TestCase):
    def test_an_unknown_api_path_returns_the_json_envelope_with_not_found(self):
        response = Client().get('/api/v1/nope')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response['Content-Type'], 'application/json')
        body = response.json()
        self.assertEqual(set(body), {'data', 'issues', 'schema_version'})
        self.assertEqual([i['code'] for i in body['issues']], ['NOT_FOUND'])
        self.assertEqual(body['schema_version'], '1')
        self.assertEqual(response['Cache-Control'], 'no-store')

    def test_a_nested_unknown_api_path_and_a_signed_in_caller_get_the_same_answer(self):
        client = Client()
        self.signup(client, 'not-found-student')
        for path in ('/api/v1/plans/not-a-uuid', '/api/v1/record/extra', '/api/v1/'):
            response = client.get(path)
            self.assertEqual((response.status_code, response['Content-Type']), (404, 'application/json'), path)
            self.assertEqual(response.json()['issues'][0]['code'], 'NOT_FOUND', path)

    def test_known_routes_are_unchanged(self):
        # Negative: the catch-all must not shadow a real route.
        self.assertEqual(Client().get('/api/v1/health').status_code, 200)
        self.assertEqual(Client().get('/api/v1/plans').status_code, 401)
