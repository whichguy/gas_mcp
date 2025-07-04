/**
 * User model and validation
 */

class User {
  constructor(name, email, role) {
    this.name = name;
    this.email = email;
    this.role = role || 'user';
    this.createdAt = new Date();
  }

  validate() {
    if (!this.name || this.name.length < 2) {
      return { valid: false, error: 'Name must be at least 2 characters' };
    }
    if (!validateEmail(this.email)) {
      return { valid: false, error: 'Invalid email format' };
    }
    return { valid: true };
  }

  getInfo() {
    return {
      name: this.name,
      email: this.email,
      role: this.role,
      created: formatDate(this.createdAt)
    };
  }
}