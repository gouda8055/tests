export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Multi-Tenant LMS &amp; Exam Platform
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        This is the base domain. Each institute is served from its own subdomain.
      </p>
    </main>
  );
}
