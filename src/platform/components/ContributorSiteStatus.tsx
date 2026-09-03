/** @jsxImportSource react */

/** Static, backend-free shell fixture used only by `npm run dev:contributor`. */
export default function ContributorSiteStatus() {
  return (
    <aside className="site-status" aria-label="Site status">
      <dl>
        <div><dt>Version</dt><dd>#000</dd></div>
        <div><dt>Contributions</dt><dd>0</dd></div>
        <div><dt>Current contributor</dt><dd>Local canvas preview</dd></div>
        <div><dt>Turn status</dt><dd>No active turn</dd></div>
      </dl>
    </aside>
  );
}
