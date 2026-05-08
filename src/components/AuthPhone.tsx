import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, UserPlus, LogIn, Phone } from "lucide-react";

const normalizePhone = (raw: string) => raw.replace(/\D/g, "");

export function AuthPhone() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || !password) {
      toast.error("Preenche todos os campos");
      return;
    }
    if (cleanPhone.length < 7) {
      toast.error("Número de telemóvel inválido");
      return;
    }
    if (password.length < 4 || password.length > 5) {
      toast.error("A senha deve ter 4 ou 5 caracteres");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        await api.auth.signUp(cleanPhone, password);
        toast.success("Conta criada!");
      } else {
        await api.auth.signIn(cleanPhone, password);
        toast.success("Login feito!");
      }
    } catch (err: any) {
      const msg = err?.message || "Erro";
      if (msg.includes("invalid credentials")) {
        toast.error("Telemóvel ou senha incorrectos");
      } else if (msg.includes("already registered")) {
        toast.error("Telemóvel já registado");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <img
            src="/logo.png"
            alt="NANTER"
            className="w-44 h-44 mx-auto object-contain"
            style={{ filter: 'drop-shadow(0 10px 30px rgba(124,58,237,0.65))' }}
            draggable={false}
          />
          <p
            className="text-white/85 font-medium"
            style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}
          >
            Joga, aposta e ganha!
          </p>
        </div>

        <div className="bg-card rounded-2xl border border-border p-6 space-y-4 shadow-xl">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Telemóvel</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="tel"
                inputMode="tel"
                placeholder="9XX XXX XXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="pl-9"
                autoComplete="tel"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Senha <span className="text-xs text-muted-foreground">(máx. 5 caracteres)</span>
            </label>
            <Input
              type="password"
              placeholder="•••••"
              value={password}
              maxLength={5}
              onChange={(e) => setPassword(e.target.value.slice(0, 5))}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          <Button onClick={handleSubmit} disabled={loading} className="w-full gap-2">
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === "login" ? (
              <LogIn className="w-4 h-4" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            {mode === "login" ? "Entrar" : "Criar Conta"}
          </Button>
          <button
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {mode === "login" ? "Não tens conta? Criar conta" : "Já tens conta? Entrar"}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Ao entrar, aceitas os termos de uso e política de privacidade.
        </p>
      </div>
    </div>
  );
}
