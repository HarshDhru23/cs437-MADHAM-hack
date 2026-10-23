import json


class AccountAPIMixin:
    password = 'Synthetic-river-946!'

    def request(self, client, method, path, payload=None):
        token = client.cookies.get('csrftoken')
        return getattr(client, method)('/api/v1' + path, data=json.dumps(payload or {}),
                                      content_type='application/json', HTTP_X_CSRFTOKEN=token.value if token else '')

    def signup(self, client, username):
        self.assertEqual(client.get('/api/v1/session').status_code, 200)
        response = self.request(client, 'post', '/auth/signup', {'username': username, 'password': self.password})
        self.assertEqual(response.status_code, 201, response.content)
