import type { CurrentTenant } from "@/lib/tenant/current";

export function TenantHeader({ tenant }: { tenant: CurrentTenant }) {
  return (
    <header className="flex items-center gap-3 border-b px-4 py-3">
      {tenant.logoUrl ? (
        // Logo URLs are arbitrary, institute-supplied hosts set only by
        // super_admin at institute creation — not known at build time, so
        // next/image's remote-pattern allowlist doesn't fit here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tenant.logoUrl} alt="" className="h-8 w-8 rounded object-contain" />
      ) : null}
      <span className="font-semibold">{tenant.name}</span>
    </header>
  );
}
