import { CircleAlert, Loader2 } from "lucide-react";

const icon = { size: 20, strokeWidth: 2, "aria-hidden": true as const };
const DEMO_PASSWORD = "scheduler-demo";

const accounts = [
  ["coordinator", "Sign in as coordinator", "btn-primary"],
  ["central.advisor", "Sign in as Central advisor", "btn-secondary"],
  ["riverside.advisor", "Sign in as Riverside advisor", "btn-secondary"],
] as const;

export function LoginScreen({
  pending,
  error,
  onSignIn,
}: {
  pending: boolean;
  error: string | null;
  onSignIn: (username: string) => void;
}) {
  return (
    <main className="shell page">
      <section className="panel" aria-labelledby="sign-in-heading">
        <div className="panel-intro">
          <h1 id="sign-in-heading">Sign in</h1>
          <p>
            Demo password <strong>{DEMO_PASSWORD}</strong>. An advisor only sees
            their own workshop. The coordinator can book at either location.
          </p>
        </div>
        {error ? (
          <div className="banner bad" role="alert">
            <CircleAlert {...icon} />
            <div>
              <strong>Sign-in failed.</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : null}
        <div className="actions">
          {accounts.map(([username, label, className]) => (
            <button
              key={username}
              type="button"
              className={className}
              disabled={pending}
              onClick={() => onSignIn(username)}
            >
              {pending ? <Loader2 className="spin" {...icon} /> : null}
              {label}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
