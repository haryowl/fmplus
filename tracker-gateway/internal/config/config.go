package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	DatabaseURL    string
	HTTPAddr       string
	TeltonikaAddr  string
	JT808Addr      string
	SuBiaoAddr     string
	JT809Addr      string
	JT1078Addr     string
	ConcoxAddr     string
	RuptelaAddr    string
	GalileoskyAddr string
	RetentionDays  int
}

func Load() Config {
	// systemd EnvironmentFile can miss vars; also support local `go run`.
	loadEnvFile(".env.local")
	loadEnvFile(".env")
	if wd, err := os.Getwd(); err == nil {
		loadEnvFile(filepath.Join(wd, "..", ".env.local"))
		loadEnvFile(filepath.Join(wd, "..", ".env"))
	}
	return Config{
		DatabaseURL:    env("DATABASE_URL", ""),
		HTTPAddr:       env("TRACKER_HTTP_ADDR", ":5080"),
		TeltonikaAddr:  env("TRACKER_TELTONIKA_ADDR", ":5027"),
		JT808Addr:      env("TRACKER_JT808_ADDR", ":7611"),
		SuBiaoAddr:     env("TRACKER_SUBIAO_ADDR", ":7612"),
		JT809Addr:      env("TRACKER_JT809_ADDR", ":8090"),
		JT1078Addr:     env("TRACKER_JT1078_ADDR", ":1078"),
		ConcoxAddr:     env("TRACKER_CONCOX_ADDR", ":5023"),
		RuptelaAddr:    env("TRACKER_RUPTELA_ADDR", ":3047"),
		GalileoskyAddr: env("TRACKER_GALILEOSKY_ADDR", ":30175"),
		RetentionDays:  envInt("VEHICLE_FIX_RETENTION_DAYS", 14),
	}
}

// loadEnvFile sets KEY=VALUE from a dotenv file without overriding existing env.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		if k == "" || os.Getenv(k) != "" {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 {
			if (v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'') {
				v = v[1 : len(v)-1]
			}
		}
		_ = os.Setenv(k, v)
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
