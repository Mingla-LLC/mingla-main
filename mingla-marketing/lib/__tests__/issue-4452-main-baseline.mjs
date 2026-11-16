// #4452 test harness (not a test): load origin/main's report views for the TR-1 order check.
// A clone whose origin/main imports something this checkout cannot resolve (a workspace
// package, a file that moved) cannot be compiled outside the workspace. That is a baseline
// problem, not a section-order break, so the comparison is skipped with a clear log line.
// Any other error (a real bug in a view) still throws.
export function isResolveError(err) {
  if (!err) return false
  if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ERR_MODULE_NOT_FOUND') return true
  return /tsx-render: cannot resolve|Cannot find module/.test(String(err.message ?? err))
}

/** Returns { modules } when every view loads, or { skip: <reason> } on a resolve error. */
export function loadMainViews(renderer, views, log = console.log) {
  const modules = {}
  try {
    for (const [tool, [file, name]] of Object.entries(views)) modules[tool] = renderer.load(file)[name]
  } catch (err) {
    if (!isResolveError(err)) throw err
    const reason = `origin/main's report views do not compile outside the workspace (${String(err.message).split('\n')[0]})`
    log(`TR-1: skipping the origin/main order comparison: ${reason}. TR-1b (the written-out order) still runs.`)
    return { skip: reason }
  }
  return { modules }
}
