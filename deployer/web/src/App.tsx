import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Key,
  Eye,
  EyeOff,
  Server,
  Globe,
  Route,
  Upload,
  Check,
  Copy,
  ExternalLink,
  Sparkles,
  Shield,
  Zap,
  Terminal,
  X,
  ChevronDown,
  Cloud,
  Lock,
  UserCircle,
  Settings,
  Rocket,
} from "lucide-react";
import { useTheme } from "./hooks/useTheme";
import ThemeToggle from "./components/ThemeToggle";
import {
  runDeploy,
  listAccounts,
  getSubdomain,
  type Account,
  type DeployResult,
  type PipelineEvent,
} from "./lib/deployer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type LineType = "info" | "success" | "error" | "warn" | "plain";

interface TerminalLine {
  id: string;
  type: LineType;
  content: React.ReactNode;
  links?: { url: string; label: string }[];
  copy?: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const cn = (...classes: (string | false | undefined)[]) =>
  classes.filter(Boolean).join(" ");

function randomString(length = 32) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let value = "";
  for (let i = 0; i < length; i++)
    value += alphabet[bytes[i] % alphabet.length];
  return value;
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1) + " MB";

/* Step titles are fixed, so every pipeline event maps onto the shared wording table. */
const MESSAGES: Record<string, string> = {
  verify: "Validating your Cloudflare API token…",
  bundle: "Loading the bundled asset index…",
  hash: "Hashing the static assets with blake3…",
  session: "Creating the asset upload session…",
  assets: "Publishing the static assets…",
  script: "Installing the Worker module and the Durable Object…",
  secrets: "Storing the JWT_SECRET and INITIAL_PASSWORD secrets…",
  enable: "Publishing the workers.dev URL…",
  health: "Waiting for the deployment to go live…",
};

function classForType(type: LineType) {
  switch (type) {
    case "info":
      return "terminal-info";
    case "success":
      return "terminal-success";
    case "error":
      return "terminal-error";
    case "warn":
      return "terminal-warn";
    default:
      return "text-text-secondary";
  }
}

function glyphForType(type: LineType) {
  switch (type) {
    case "info":
      return "›";
    case "success":
      return "✓";
    case "error":
      return "✗";
    case "warn":
      return "⚠";
    default:
      return "•";
  }
}

const RELEASE = "v0.5.86";
const STEPS = [
  {
    title: "Cloudflare account",
    description: "Sign up & verify your account.",
    icon: UserCircle,
  },
  {
    title: "Create API token",
    description: "Generate a Workers token from the template.",
    icon: Key,
  },
  {
    title: "Paste & configure",
    description: "Paste the token and choose the install type.",
    icon: Settings,
  },
  {
    title: "Get your panel",
    description: "Receive your dashboard URL and password.",
    icon: Rocket,
  },
];

const TOKEN_TEMPLATE_URL = (() => {
  const permissions = [
    { key: "workers_scripts", type: "edit" },
    { key: "workers_kv_storage", type: "edit" },
    { key: "account_settings", type: "read" },
    { key: "user_details", type: "read" },
  ];
  const url = new URL("https://dash.cloudflare.com/profile/api-tokens");
  url.searchParams.set("permissionGroupKeys", JSON.stringify(permissions));
  url.searchParams.set("accountId", "*");
  url.searchParams.set("zoneId", "all");
  url.searchParams.set("name", "JB-Router-Wizard");
  return url.href;
})();

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-bg-primary" />
      <div className="absolute -left-1/4 -top-1/4 h-[80vw] w-[80vw] rounded-full bg-brand-primary/10 blur-[120px] animate-mesh" />
      <div className="absolute -bottom-1/4 -right-1/4 h-[70vw] w-[70vw] rounded-full bg-brand-hover/10 blur-[120px] animate-mesh-slow" />
      <div className="absolute left-1/3 top-1/2 h-[50vw] w-[50vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-hero-accent/10 blur-[100px] animate-pulse-glow" />
      <div className="grid-overlay" />
    </div>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function Stepper({ activeStep }: { activeStep: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-2">
      {/* Animated progress line */}
      <div className="absolute left-4 right-4 top-7 hidden h-1 sm:block">
        <div className="h-full w-full rounded-full bg-border/70" />
        <motion.div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-brand-primary via-hero-accent to-brand-hover"
          initial={{ width: "0%" }}
          animate={{
            width: `${Math.min(100, (activeStep / (STEPS.length - 1)) * 100)}%`,
          }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        />
        {/* Traveling light dot */}
        <motion.div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]"
          animate={{
            left: [
              "0%",
              `${Math.min(100, (activeStep / (STEPS.length - 1)) * 100)}%`,
            ],
          }}
          transition={{
            duration: 1.2,
            ease: "easeOut",
            repeat: activeStep === STEPS.length - 1 ? Infinity : 0,
            repeatType: "reverse",
            repeatDelay: 0.5,
          }}
        />
      </div>

      <ol className="relative grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-2">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === activeStep;
          const isDone = idx < activeStep;
          return (
            <motion.li
              key={idx}
              initial={{ opacity: 0, y: 30, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                delay: idx * 0.12,
                type: "spring",
                stiffness: 260,
                damping: 20,
              }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="relative flex flex-col items-center text-center"
            >
              {/* Ripple rings for active step */}
              {isActive && (
                <>
                  <motion.span
                    className="absolute inset-0 m-auto h-10 w-10 rounded-full border border-brand-primary/30"
                    animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeOut",
                    }}
                  />
                  <motion.span
                    className="absolute inset-0 m-auto h-10 w-10 rounded-full border border-brand-primary/20"
                    animate={{ scale: [1, 2.2], opacity: [0.4, 0] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeOut",
                      delay: 0.3,
                    }}
                  />
                </>
              )}

              {/* Step circle */}
              <motion.div
                className={cn(
                  "relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors duration-300",
                  isDone
                    ? "border-success bg-success text-white"
                    : isActive
                      ? "border-brand-primary bg-brand-primary text-white"
                      : "border-border bg-surface text-text-tertiary",
                )}
                animate={
                  isActive
                    ? {
                        scale: [1, 1.12, 1],
                        boxShadow: [
                          "0 0 0px rgba(229,106,74,0)",
                          "0 0 20px rgba(229,106,74,0.5)",
                          "0 0 0px rgba(229,106,74,0)",
                        ],
                      }
                    : isDone
                      ? {
                          scale: [1, 1.05, 1],
                          boxShadow: [
                            "0 0 0px rgba(34,197,94,0)",
                            "0 0 14px rgba(34,197,94,0.4)",
                            "0 0 0px rgba(34,197,94,0)",
                          ],
                        }
                      : { scale: 1 }
                }
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                {isDone ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </motion.div>

              {/* Label */}
              <motion.div
                className="mt-3 px-1"
                animate={isActive ? { y: [0, -2, 0] } : { y: 0 }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <h4
                  className={cn(
                    "text-xs font-bold transition-colors sm:text-sm",
                    isActive
                      ? "text-brand-primary"
                      : isDone
                        ? "text-text-primary"
                        : "text-text-tertiary",
                  )}
                >
                  {step.title}
                </h4>
                <p className="mt-0.5 hidden text-[10px] leading-tight text-text-tertiary sm:block sm:text-xs">
                  {step.description}
                </p>
              </motion.div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

function TerminalPanel({
  lines,
  running,
  onCopy,
}: {
  lines: TerminalLine[];
  running: boolean;
  onCopy: (text: string) => void;
}) {
  const copyToClipboard = onCopy;
  const bottomRef = useRef<HTMLDivElement>(null);

  // Only follow new output (never scroll the page on first paint) and keep it inside the panel.
  useEffect(() => {
    if (!lines.length) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines]);

  return (
    <div className="glass relative flex h-full min-h-[420px] flex-col rounded-2xl overflow-hidden shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3 light:border-border">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-brand-primary" />
          <span className="text-xs font-medium text-text-secondary light:text-text-secondary">
            Deployment Console
          </span>
        </div>
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-error/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-warning/80" />
          <div className="h-2.5 w-2.5 rounded-full bg-success/80" />
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed">
        {lines.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-text-tertiary">
            <Sparkles className="h-8 w-8 opacity-50" />
            <p className="text-xs">
              Paste your token and press Install to begin.
            </p>
          </div>
        )}
        {lines.map((line) => (
          <div key={line.id} className="mb-1.5 break-words">
            <span className={cn("mr-2 font-bold", classForType(line.type))}>
              {glyphForType(line.type)}
            </span>
            <span className="text-text-secondary light:text-text-secondary">
              {line.content}
            </span>
            {line.copy && (
              <button
                onClick={() => copyToClipboard(line.copy!)}
                className="ml-2 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-tertiary transition-colors hover:border-brand-primary/50 hover:text-brand-primary"
                title="Copy"
              >
                copy
              </button>
            )}
            {line.links?.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 font-semibold text-brand-primary underline underline-offset-2 hover:text-brand-hover"
                title={`Open ${link.url}`}
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        ))}
        {running && (
          <div className="mt-1 text-brand-primary">
            <span className="terminal-cursor">▋</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg-secondary/80 to-transparent light:from-surface/60" />
    </div>
  );
}

function Toast({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      className="glass relative rounded-xl border border-success/20 bg-success/5 p-4 light:bg-success/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-success">
          <Check className="h-4 w-4" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary light:hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2 text-sm text-text-secondary light:text-text-secondary">
        {children}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export default function App() {
  const { resolved, set } = useTheme();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [workerName, setWorkerName] = useState("jb-router");
  const [deployType, setDeployType] = useState<"full" | "dryrun">("full");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [showAccountSelect, setShowAccountSelect] = useState(false);
  const [showSubdomainInput, setShowSubdomainInput] = useState(false);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [deployment, setDeployment] = useState<{
    url: string;
    password: string;
  } | null>(null);
  const [quickLink, setQuickLink] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [copied, setCopied] = useState(false);

  const addLine = (
    type: LineType,
    content: React.ReactNode,
    copy?: string,
    links?: { url: string; label: string }[],
  ) => {
    const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    setLines((prev) => [...prev, { id, type, content, copy, links }]);
  };

  const resetTerminal = () => setLines([]);

  /** Real account lookup: the wizard only asks when the token can see several accounts. */
  const resolveAccount = async (cfToken: string): Promise<Account | null> => {
    const { accounts: list } = await listAccounts({ cfToken });
    if (!list.length) throw new Error("This token cannot access any Cloudflare account.");
    setAccounts(list);
    if (list.length === 1) {
      setAccountId(list[0].id);
      return list[0];
    }
    setShowAccountSelect(true);
    const preferred = new URLSearchParams(location.search).get("account");
    const chosen = list.find((a) => a.id === preferred) || list[0];
    setAccountId(chosen.id);
    addLine(
      "info",
      `This token can access ${list.length} accounts — the selected one is used (change it in the list above).`,
    );
    return chosen;
  };

  /** Real subdomain lookup, registering the typed name when the account has none yet. */
  const resolveSubdomain = async (cfToken: string, acc: string): Promise<string | null> => {
    const current = await getSubdomain({ cfToken, accountId: acc });
    if (current.subdomain) return current.subdomain;
    setShowSubdomainInput(true);
    const typed = subdomain.trim().toLowerCase();
    if (!typed) {
      addLine(
        "info",
        "This account has no workers.dev subdomain yet — type one above and press Install again.",
      );
      return null;
    }
    const created = await getSubdomain({ cfToken, accountId: acc, set: typed });
    if (!created.subdomain) throw new Error("Cloudflare did not accept that workers.dev subdomain — try another one.");
    addLine("success", `Registered the workers.dev subdomain "${created.subdomain}".`);
    setSubdomain(created.subdomain);
    return created.subdomain;
  };

  /**
   * Renders every pipeline event as a terminal line. All deploy logic lives in
   * static/pipeline.js — the same module the Node end-to-end tests run.
   */
  const handlePipelineEvent = (event: PipelineEvent) => {
    switch (event.type) {
      case "step":
        if (event.state === "active") {
          addLine("info", MESSAGES[event.id] || event.id);
          if (event.id === "verify") setActiveStep(1);
          if (event.id === "bundle") setActiveStep(2);
        }
        break;
      case "progress":
        break;
      case "event":
        return handleMilestone(event.key, event.data);
      default:
        break;
    }
  };

  const handleMilestone = (key: string, d: Record<string, unknown>) => {
    const num = (value: unknown) => Number(value || 0);
    switch (key) {
      case "verify.ok":
        addLine("success", `Token is active (id ${String(d.tokenId).slice(0, 8)}…).`);
        break;
      case "bundle.ok":
        addLine(
          "success",
          d.streamed
            ? `Bundle ready: ${num(d.files)} files${d.release ? ` (${d.release})` : ""} — served by the deployer, nothing large is downloaded here.`
            : `Payload ready: ${num(d.files)} files, ${mb(num(d.bytes))}${d.release ? ` (${d.release})` : ""}.`,
        );
        break;
      case "session.ok":
        addLine(
          "success",
          num(d.pending) === 0
            ? "Upload session ready — every asset file is already on this account."
            : d.streamed
              ? `Upload session ready — ${num(d.pending)} files will be streamed to Cloudflare from the deployer (${num(d.buckets)} chunks, ${mb(num(d.pendingBytes))}), not from this browser.`
              : `Upload session ready — ${num(d.pending)} files need uploading (${num(d.buckets)} buckets).`,
        );
        break;
      case "assets.ok":
        addLine("success", `Static assets ready: ${num(d.total)} files${d.streamed ? " (streamed inside Cloudflare)" : ""}.`);
        break;
      case "script.ok":
        addLine(
          "success",
          `Worker "${d.name}" deployed (deployment ${String(d.deploymentId).slice(0, 8)}…, assets: ${d.hasAssets}).`,
        );
        break;
      case "secrets.ok":
        addLine("success", `Secrets stored: ${(d.stored as string[]).join(", ")}.`);
        break;
      case "enable.ok":
        addLine("success", "Public URL: ", undefined, [{ url: String(d.url), label: String(d.url) }]);
        break;
      case "health.waiting":
        addLine("info", "The workers.dev route is still propagating — retrying every 2.5 seconds…");
        break;
      case "health.slow":
        addLine(
          "info",
          "The deployment is finished — only the workers.dev route is still warming up. The check keeps running in the background.",
        );
        setActiveStep(3);
        break;
      case "health.late":
        addLine("success", `Health check passed after ${Math.round(num(d.ms) / 1000)}s — the panel is live.`);
        break;
      case "health.giveup":
        addLine("info", "The URL did not answer yet; open the dashboard link and refresh if needed.");
        break;
      case "health.ok":
        addLine("success", `Health check passed in ${(num(d.ms) / 1000).toFixed(1)}s.`);
        break;
      case "health.timeout":
        addLine("error", "The Worker did not answer the health check in time — try the dashboard URL, it usually comes up shortly.");
        break;
      case "failure":
        addLine("error", String(d.message || "Deployment failed."));
        break;
      default:
        break;
    }
  };

  const handleInstall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (running) return;

    const name = (workerName.trim() || "jb-router").toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
      addLine("error", "Worker name must use lowercase letters, digits and dashes only.");
      return;
    }
    if (!token.trim()) {
      addLine("error", "Paste your Cloudflare API token first.");
      return;
    }

    setRunning(true);
    setDeployment(null);
    setQuickLink("");
    resetTerminal();
    setActiveStep(0);

    const password = randomString(24);
    const jwtSecret = randomString(48);
    const started = Date.now();

    try {
      const account = await resolveAccount(token.trim());
      if (!account) return;

      const resolvedSubdomain = await resolveSubdomain(token.trim(), account.id);
      if (!resolvedSubdomain) return;

      addLine("info", `Installing into account "${account.name}" as worker "${name}"…`);
      addLine("info", "Everything heavy is streamed between the deployer and Cloudflare — this browser only sends the token and small JSON requests.");

      const result: DeployResult = await runDeploy({
        cfToken: token.trim(),
        accountId: account.id,
        name,
        subdomain: resolvedSubdomain,
        password,
        jwtSecret,
        release: RELEASE,
        dryRun: deployType === "dryrun",
        foregroundMs: 40000,
        onEvent: handlePipelineEvent,
      });

      if (result.dryRun) {
        addLine("success", "Dry run finished — the token, account and URL are valid. Nothing was installed.");
        addLine("info", "Planned URL:", undefined, [{ url: result.url, label: result.url }]);
        setActiveStep(3);
        return;
      }

      addLine(
        "success",
        result.health === "ok"
          ? "JB-Router successfully installed!"
          : "JB-Router installed — waiting for the URL to activate.",
      );
      addLine("info", "Dashboard: ", undefined, [{ url: `${result.url}/login`, label: `${result.url}/login` }]);
      addLine("info", "API endpoint (OpenAI compatible): ", undefined, [{ url: `${result.url}/v1`, label: `${result.url}/v1` }]);
      addLine("info", "Dashboard password: " + password, password);
      addLine("info", `Log in as "admin" with that password · finished in ${Math.round((Date.now() - started) / 1000)}s.`);

      setDeployment({ url: result.url, password });
      setQuickLink(
        `${location.origin}${location.pathname}?name=${encodeURIComponent(name)}&sub=${encodeURIComponent(
          resolvedSubdomain,
        )}&type=${deployType}&account=${account.id}`,
      );
      setActiveStep(3);
    } catch (err) {
      addLine("error", err instanceof Error ? err.message : String(err));
      addLine("info", "Nothing was left half-installed: re-run the wizard once the issue is fixed.");
    } finally {
      setRunning(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  // Load query params on mount
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("name")) setWorkerName(params.get("name")!);
    if (params.get("sub")) setSubdomain(params.get("sub")!);
    if (params.get("type") === "dryrun") setDeployType("dryrun");
    if (params.get("account")) {
      setAccounts([
        { id: params.get("account")!, name: "Pre-selected Account" },
      ]);
      setAccountId(params.get("account")!);
      setShowAccountSelect(true);
    }
    addLine("info", "Ready. Paste a Cloudflare API token and press Install.");
  }, []);

  const isLight = resolved === "light";

  return (
    <div className="relative min-h-screen selection:bg-brand-glow">
      <AnimatedBackground />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-bg-primary/50 backdrop-blur-xl light:border-border light:bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-hero-from via-hero-to to-hero-accent shadow-lg shadow-brand-glow">
              <Route className="h-5 w-5 text-white" />
              <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-success text-[8px] font-bold text-text-primary">
                <Zap className="h-2.5 w-2.5" />
              </div>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-text-primary light:text-text-primary">
                JB-Router <span className="text-brand-primary">Wizard</span>
              </h1>
              <p className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                Deployer {RELEASE}
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2"
          >
            <a
              href="https://github.com/EmamShahrooz-JB/JB-Router"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface-elevated/5 px-3 text-sm font-medium text-text-secondary transition-all hover:border-brand-primary/50 hover:bg-brand-soft hover:text-brand-primary light:bg-surface-elevated"
            >
              <GithubIcon className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
            <ThemeToggle
              checked={resolved === "dark"}
              onChange={(checked) => set(checked ? "dark" : "light")}
            />
          </motion.div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-10 text-center"
        >
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-brand-primary/20 bg-brand-soft px-4 py-1.5 text-xs font-medium text-brand-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span>One-click install for Cloudflare Workers</span>
          </div>
          <h2 className="mt-4 text-4xl font-extrabold tracking-tight text-text-primary sm:text-5xl">
            Install JB-Router in{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-hero-from via-hero-to to-hero-accent">
              seconds
            </span>
            .
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-text-tertiary light:text-text-secondary">
            Paste your Cloudflare API token, pick a name, and let the wizard
            deploy your own router panel with a dashboard URL, password, and
            OpenAI-compatible API endpoint. About 20 seconds, and the heavy
            payload never crosses your connection.
          </p>
        </motion.section>

        <div className="grid gap-8 lg:grid-cols-12">
          {/* Left column: stepper + form */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-5 space-y-6"
          >
            <div className="rounded-2xl border border-border bg-surface p-6">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-text-tertiary">
                How it works
              </h3>
              <Stepper activeStep={activeStep} />
            </div>

            <form
              onSubmit={handleInstall}
              className="rounded-2xl border border-border bg-surface p-6 space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-text-primary light:text-text-primary">
                  Configuration
                </h3>
                <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand-primary">
                  {deployType === "full" ? "Full install" : "Dry run"}
                </span>
              </div>

              {/* API Token */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  <Key className="h-3.5 w-3.5" /> Cloudflare API Token
                </label>
                <div
                  className={cn(
                    "input-ring flex items-center gap-3 rounded-xl border bg-surface-elevated/5 px-4 py-3 transition-all light:bg-surface-elevated light:border-border",
                    isLight ? "border-border" : "border-border",
                  )}
                >
                  <input
                    type={showToken ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste your API token here"
                    className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none light:text-text-primary"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((s) => !s)}
                    className="text-text-tertiary hover:text-brand-primary transition-colors"
                    title={showToken ? "Hide token" : "Show token"}
                  >
                    {showToken ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-text-tertiary">
                  Create a token from the{" "}
                  <a
                    href={TOKEN_TEMPLATE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-primary hover:text-brand-primary underline underline-offset-2"
                  >
                    Workers template
                  </a>
                  , then continue to summary and create it.
                </p>
              </div>

              {/* Worker Name */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  <Server className="h-3.5 w-3.5" /> Worker Name
                </label>
                <div
                  className={cn(
                    "input-ring flex items-center gap-3 rounded-xl border bg-surface-elevated/5 px-4 py-3 transition-all light:bg-surface-elevated",
                    isLight ? "border-border" : "border-border",
                  )}
                >
                  <input
                    type="text"
                    value={workerName}
                    onChange={(e) => setWorkerName(e.target.value)}
                    placeholder="jb-router"
                    spellCheck={false}
                    className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none light:text-text-primary"
                  />
                </div>
              </div>

              {/* Account Select (conditional) */}
              <AnimatePresence>
                {showAccountSelect && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5 overflow-hidden"
                  >
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                      <Cloud className="h-3.5 w-3.5" /> Account
                    </label>
                    <div className="relative">
                      <select
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        className={cn(
                          "input-ring w-full appearance-none rounded-xl border bg-surface-elevated/5 px-4 py-3 pr-10 text-sm text-text-primary outline-none light:bg-surface-elevated light:text-text-primary",
                          isLight ? "border-border" : "border-border",
                        )}
                      >
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} — {acc.id.slice(0, 12)}...
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Subdomain Input (conditional) */}
              <AnimatePresence>
                {showSubdomainInput && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5 overflow-hidden"
                  >
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                      <Globe className="h-3.5 w-3.5" /> workers.dev Subdomain
                    </label>
                    <div
                      className={cn(
                        "input-ring flex items-center gap-3 rounded-xl border bg-surface-elevated/5 px-4 py-3 transition-all light:bg-surface-elevated",
                        isLight ? "border-border" : "border-border",
                      )}
                    >
                      <input
                        type="text"
                        value={subdomain}
                        onChange={(e) => setSubdomain(e.target.value)}
                        placeholder="your-name"
                        spellCheck={false}
                        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none light:text-text-primary"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Deploy Type */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  <Route className="h-3.5 w-3.5" /> Installation Type
                </label>
                <div className="relative">
                  <select
                    value={deployType}
                    onChange={(e) =>
                      setDeployType(e.target.value as "full" | "dryrun")
                    }
                    className={cn(
                      "input-ring w-full appearance-none rounded-xl border bg-surface-elevated/5 px-4 py-3 pr-10 text-sm text-text-primary outline-none light:bg-surface-elevated light:text-text-primary",
                      isLight ? "border-border" : "border-border",
                    )}
                  >
                    <option value="full">
                      Cloudflare Workers — full installation
                    </option>
                    <option value="dryrun">
                      Cloudflare Workers — validate only (dry run)
                    </option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                </div>
              </div>

              {/* Install Button */}
              <motion.button
                whileHover={{ scale: running ? 1 : 1.02 }}
                whileTap={{ scale: running ? 1 : 0.98 }}
                disabled={running}
                type="submit"
                className={cn(
                  "group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-6 py-3.5 text-sm font-bold text-white transition-all",
                  running
                    ? "cursor-not-allowed bg-surface-hover"
                    : "animate-shimmer bg-gradient-to-r from-brand-primary via-brand-hover to-hero-accent hover:shadow-lg hover:shadow-brand-glow",
                )}
              >
                {running ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
                    Install JB-Router
                  </>
                )}
              </motion.button>

              <p className="text-center text-xs text-text-tertiary">
                No CLI, no Git, no server of your own — the page talks to the
                deployer Worker, which streams the 21 MB payload inside Cloudflare.
              </p>
            </form>

            {/* Toasts */}
            <div className="space-y-4">
              <AnimatePresence>
                {quickLink && (
                  <Toast
                    title="JB-Router quick link"
                    onClose={() => setQuickLink("")}
                  >
                    <div className="space-y-2">
                      <p className="text-xs">
                        Bookmark this link to re-run the wizard with the same
                        settings.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded-lg bg-bg-tertiary px-2 py-1 text-xs text-text-secondary">
                          {quickLink}
                        </code>
                        <button
                          onClick={() => copyToClipboard(quickLink)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-elevated/10 text-text-secondary hover:bg-brand-soft hover:text-brand-primary"
                          title="Copy link"
                        >
                          {copied ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </Toast>
                )}

                {deployment && (
                  <Toast
                    title="Successfully installed"
                    onClose={() => setDeployment(null)}
                  >
                    <div className="space-y-2">
                      <p className="text-xs">
                        Your dashboard is live. Log in as <strong>admin</strong>
                        .
                      </p>
                      <div className="grid gap-2">
                        <a
                          href={`${deployment.url}/login`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 rounded-lg bg-success/15 px-3 py-2 text-xs font-semibold text-success transition-colors hover:bg-success/20"
                        >
                          Open Dashboard <ExternalLink className="h-3 w-3" />
                        </a>
                        <div className="flex items-center gap-2 rounded-lg bg-bg-tertiary px-3 py-2">
                          <Lock className="h-3 w-3 text-text-tertiary" />
                          <code className="flex-1 text-xs text-text-secondary">
                            {deployment.password}
                          </code>
                          <button
                            onClick={() => copyToClipboard(deployment.password)}
                            className="text-text-tertiary hover:text-brand-primary"
                          >
                            {copied ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </Toast>
                )}
              </AnimatePresence>
            </div>

            {/* Feature cards */}
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: Shield,
                  title: "Secure",
                  desc: "Password + JWT secret stored as Worker secrets.",
                },
                {
                  icon: Zap,
                  title: "Fast",
                  desc: "~20 seconds, even on a slow connection.",
                },
                {
                  icon: Lock,
                  title: "In-memory",
                  desc: "The token is used for one request and never stored.",
                },
              ].map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.1 }}
                  className="rounded-xl border border-border bg-surface p-4"
                >
                  <f.icon className="mb-2 h-5 w-5 text-brand-primary" />
                  <h4 className="text-sm font-semibold text-text-primary">
                    {f.title}
                  </h4>
                  <p className="text-xs text-text-tertiary">{f.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Right column: terminal */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="lg:col-span-7"
          >
            <TerminalPanel lines={lines} running={running} onCopy={copyToClipboard} />
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border-subtle py-12 light:border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-6">
              <h4 className="mb-3 text-sm font-bold text-text-primary">
                About JB-Router
              </h4>
              <p className="text-sm leading-relaxed text-text-secondary">
                Deploy your own OpenAI-compatible router panel on Cloudflare
                Workers in seconds. Private, fast, and fully self-hosted.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-6">
              <h4 className="mb-3 text-sm font-bold text-text-primary">
                Quick Links
              </h4>
              <div className="flex flex-col gap-2 text-sm text-text-secondary">
                <a
                  href="https://github.com/EmamShahrooz-JB/JB-Router"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-brand-primary"
                >
                  GitHub Repository
                </a>
                <a
                  href="https://dash.cloudflare.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-brand-primary"
                >
                  Cloudflare Dashboard
                </a>
                <a
                  href={TOKEN_TEMPLATE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-brand-primary"
                >
                  Create API Token
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-6">
              <h4 className="mb-3 text-sm font-bold text-text-primary">
                Security Note
              </h4>
              <p className="text-sm leading-relaxed text-text-secondary">
                Cloudflare's API sends no CORS headers, so a browser cannot call it
                directly: your token is passed to the deployer Worker for this one
                request, used in memory only, and never stored or logged. Revoke it
                in the Cloudflare dashboard after the install.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border-subtle pt-8 sm:flex-row light:border-border">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-hero-from via-hero-to to-hero-accent">
                <Route className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-bold text-text-primary">
                JB-Router Wizard
              </span>
            </div>
            <p className="text-xs text-text-tertiary">
              Not affiliated with Cloudflare · Open source by{" "}
              <a
                href="https://github.com/EmamShahrooz-JB"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-primary hover:underline"
              >
                EmamShahrooz-JB
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
