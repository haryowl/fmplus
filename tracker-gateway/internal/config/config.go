package config

import (
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL    string
	HTTPAddr       string
	TeltonikaAddr  string
	JT808Addr      string
	ConcoxAddr     string
	RuptelaAddr    string
	GalileoskyAddr string
	RetentionDays  int
}

func Load() Config {
	return Config{
		DatabaseURL:    env("DATABASE_URL", ""),
		HTTPAddr:       env("TRACKER_HTTP_ADDR", ":5080"),
		TeltonikaAddr:  env("TRACKER_TELTONIKA_ADDR", ":5027"),
		JT808Addr:      env("TRACKER_JT808_ADDR", ":7611"),
		ConcoxAddr:     env("TRACKER_CONCOX_ADDR", ":5023"),
		RuptelaAddr:    env("TRACKER_RUPTELA_ADDR", ":3047"),
		GalileoskyAddr: env("TRACKER_GALILEOSKY_ADDR", ":30175"),
		RetentionDays:  envInt("VEHICLE_FIX_RETENTION_DAYS", 14),
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
