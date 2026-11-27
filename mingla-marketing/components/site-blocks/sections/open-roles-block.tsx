// #4636 live block `openRoles` — the careers roles (META-ORCH-1222): the live
// open roles from listOpenRoles(), "No open roles right now." with Follow
// @usemingla when there are none, or the error panel. Moved as-is (R1) from
// app/careers/page.tsx; inside the programme frame (pb-100 > wrap). Role
// cards open /roles/<slug> on the careers host, unchanged.
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { employmentLabel, listOpenRoles, type JobPosting } from '@/lib/careers-data'

const INSTAGRAM_URL = 'https://www.instagram.com/usemingla'

export type OpenRolesContent = Record<string, never>

function EmptyPanel() {
  return (
    <div className="empty reveal" data-careers-state="empty">
      <h2 className="h2">
        No open roles <em>right now.</em>
      </h2>
      <p className="lead">New roles are posted here first, and on @usemingla.</p>
      <div className="row">
        <a className="btn ink" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
          Follow @usemingla
        </a>
      </div>
    </div>
  )
}

function ErrorPanel() {
  return (
    <div className="empty" data-careers-state="error" role="alert">
      <h2 className="h2">
        We couldn’t load <em>the roles.</em>
      </h2>
      <p className="lead">That’s on us. Give it another shot.</p>
      <div className="row">
        <Link className="btn ink" href="/">
          Try again
        </Link>
      </div>
    </div>
  )
}

function RoleCards({ roles }: { roles: JobPosting[] }) {
  return (
    <ul className="grid2" data-careers-state="open">
      {roles.map((role) => (
        <li key={role.slug}>
          <Link className="card pad role-card" href={`/roles/${role.slug}`}>
            <span className="for">
              {role.department} · {role.location} · {employmentLabel(role.employment_type)}
            </span>
            <h2 className="h3">{role.title}</h2>
            <p className="muted">{role.summary}</p>
            <span className="role-foot">
              <b>{role.salary_display}</b>
              <span className="btn soft sm">
                View role <ArrowRight aria-hidden="true" />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The roles, read once per request (the page is force-dynamic). */
export async function OpenRolesBlock() {
  let roles: JobPosting[] | null = null
  let errored = false
  try {
    roles = await listOpenRoles()
  } catch {
    errored = true
  }
  return <div className="mt-24">{errored ? <ErrorPanel /> : !roles || roles.length === 0 ? <EmptyPanel /> : <RoleCards roles={roles} />}</div>
}
