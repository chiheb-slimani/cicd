export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-4 px-8">
      <h1 className="text-4xl font-bold">Next.js CI/CD Demo</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-300">
        This repository is configured for lint, test, build, Docker image
        creation, and Jenkins automation.
      </p>
    </main>
  );
}
