class ValidationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [String(errors)];
    super(list.join('; '));
    this.name = 'ValidationError';
    this.errors = list;
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Anda tidak memiliki akses.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends Error {
  constructor(message = 'Data tidak ditemukan.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

module.exports = { ValidationError, ForbiddenError, NotFoundError };
