/** @jsxImportSource react */

/** Static, backend-free shell fixture used only by `npm run dev:contributor`. */
export default function ContributorSiteStatus() {
  return (
    <aside className="site-status" aria-label="site status">
      <dl>
        <div><dt>version</dt><dd>#000</dd></div>
        <div><dt>contributions</dt><dd>0</dd></div>
        <div><dt>current contributor</dt><dd>local canvas preview</dd></div>
        <div><dt>turn status</dt><dd>no active turn</dd></div>
      </dl>
    </aside>
  );
}
