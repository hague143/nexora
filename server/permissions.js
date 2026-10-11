const APPROVE_ROLES = new Set(['admin'])
const EXPENSE_MANAGER_LIMIT = 5000

function canApprove(user) {
  return APPROVE_ROLES.has(user.role)
}

function canManageRoles(user) {
  return user.role === 'admin'
}

function canSeeAllDepartments(user) {
  return user.role === 'admin' || user.role === 'manager'
}

function departmentScope(user) {
  if (canSeeAllDepartments(user)) return null
  return user.department
}

function canExecute(user, parsed) {
  const action = parsed.action
  const amount = Number(parsed.fields?.amount)
  if (action === 'query' || action === 'create' || action === 'update') {
    if (user.role === 'employee' && parsed.department && parsed.department !== user.department && user.department) {
      return { ok: false, reason: `Employees can only act in ${user.department}.` }
    }
    if (action !== 'query' && parsed.requires_approval && !canApprove(user)) {
      return { ok: true, status: 'pending_approval' }
    }
    return { ok: true, status: action === 'query' ? 'completed' : 'completed' }
  }
  if (action === 'approve' || action === 'reject' || action === 'cancel') {
    if (!canApprove(user)) {
      return { ok: false, reason: `Your ${user.role} role cannot ${action} ${parsed.entity} records.` }
    }
    if (user.role === 'manager' && !Number.isNaN(amount) && amount > EXPENSE_MANAGER_LIMIT) {
      return { ok: false, reason: `Managers cannot approve amounts above $${EXPENSE_MANAGER_LIMIT.toLocaleString()}.` }
    }
    return { ok: true, status: action === 'approve' ? 'completed' : 'rejected' }
  }
  return { ok: true, status: 'completed' }
}

function approvalRequired(parsed, user) {
  if (parsed.requires_approval && !canApprove(user)) return true
  const amount = Number(parsed.fields?.amount)
  if (['approve', 'create'].includes(parsed.action) && !Number.isNaN(amount) && amount >= 1000 && user.role === 'employee') {
    return true
  }
  return Boolean(parsed.requires_approval && user.role === 'employee')
}

module.exports = {
  canApprove,
  canManageRoles,
  canSeeAllDepartments,
  departmentScope,
  canExecute,
  approvalRequired,
  EXPENSE_MANAGER_LIMIT,
}
