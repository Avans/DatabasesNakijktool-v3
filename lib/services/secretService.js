// Tokens handed out for an approved submission.
const crypto = require('crypto');

class SecretService {
  constructor() {
    this.secretKey = process.env.SECRET_KEY || 'your-secret-key-for-assignment-tokens';
  }

  getAssignmentToken(email, assignmentId) {
    const data = `${email}:${assignmentId}:${new Date().toISOString()}`;
    return crypto.createHmac('sha256', this.secretKey).update(data).digest('hex');
  }
}

module.exports = new SecretService();
