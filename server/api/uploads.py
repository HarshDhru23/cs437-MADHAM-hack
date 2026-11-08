"""The only upload handler: transcript PDFs stay in memory and never touch disk (coursepath/imports/pdf_transcript.py).
A request over DATA_UPLOAD_MAX_MEMORY_SIZE is refused before its body is read, and a file over FILE_UPLOAD_MAX_MEMORY_SIZE (10 MB) stops being
read at the limit. Either way the request is marked `upload_too_large` and the view answers 413 INPUT_LIMIT."""
from io import BytesIO
from django.conf import settings
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.core.files.uploadhandler import FileUploadHandler, StopFutureHandlers, StopUpload
from django.http import QueryDict
from django.utils.datastructures import MultiValueDict


class LimitedMemoryUploadHandler(FileUploadHandler):
    def handle_raw_input(self, input_data, META, content_length, boundary, encoding=None):
        if content_length is not None and content_length > settings.DATA_UPLOAD_MAX_MEMORY_SIZE:
            self.request.upload_too_large = True
            return QueryDict(encoding=encoding), MultiValueDict()  # nothing is parsed or stored

    def new_file(self, *args, **kwargs):
        super().new_file(*args, **kwargs)
        self.file = BytesIO()
        raise StopFutureHandlers()

    def receive_data_chunk(self, raw_data, start):
        if start + len(raw_data) > settings.FILE_UPLOAD_MAX_MEMORY_SIZE:
            self.file.close()  # drop what was kept so far
            self.request.upload_too_large = True
            raise StopUpload(connection_reset=False)  # the rest of the body is read and discarded, never kept
        self.file.write(raw_data)

    def file_complete(self, file_size):
        self.file.seek(0)
        return InMemoryUploadedFile(file=self.file, field_name=self.field_name, name=self.file_name, content_type=self.content_type,
                                    size=file_size, charset=self.charset, content_type_extra=self.content_type_extra)
