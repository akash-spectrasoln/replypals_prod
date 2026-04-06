import { NavLink } from 'react-router-dom'

const linkClass = ({ isActive }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-100 text-indigo-900' : 'text-slate-600 hover:bg-slate-100'}`

export function Sidebar() {
  return (
    <aside className="flex w-56 flex-col border-r border-slate-200 bg-white p-4">
      <div className="mb-6 text-lg font-bold text-indigo-700">ReplyPals Admin</div>
      <nav className="flex flex-col gap-1">
        <NavLink to="/" end className={linkClass}>
          Dashboard
        </NavLink>
        <NavLink to="/users" className={linkClass}>
          Users
        </NavLink>
        <NavLink to="/logs" className={linkClass}>
          Logs
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          Settings
        </NavLink>
      </nav>
    </aside>
  )
}
