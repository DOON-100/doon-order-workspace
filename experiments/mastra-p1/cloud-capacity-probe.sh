#!/usr/bin/env bash
# Passive OS metrics only. No application imports, network requests or file writes.
set -eu
set -o pipefail
export LC_ALL=C
export TZ=UTC
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

services=()
while (($#)); do
  case "$1" in
    --service)
      if (($# < 2)); then
        printf '%s\n' 'ERROR=--service requires an explicit unit name' >&2
        exit 64
      fi
      unit=$2
      if [[ ${#unit} -gt 128 || ! $unit =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]*\.service$ ]]; then
        printf '%s\n' 'ERROR=invalid service name; paths, patterns and shell syntax are forbidden' >&2
        exit 64
      fi
      for existing in "${services[@]}"; do
        if [[ $existing == "$unit" ]]; then
          printf '%s\n' 'ERROR=duplicate service name' >&2
          exit 64
        fi
      done
      services+=("$unit")
      if ((${#services[@]} > 8)); then
        printf '%s\n' 'ERROR=at most eight explicit services are allowed' >&2
        exit 64
      fi
      shift 2
      ;;
    --help)
      printf '%s\n' 'Usage: bash cloud-capacity-probe.sh [--service NAME.service ...]'
      printf '%s\n' 'One fixed 10-second passive sample. No services are queried unless explicitly named.'
      exit 0
      ;;
    *)
      printf '%s\n' 'ERROR=unsupported argument' >&2
      exit 64
      ;;
  esac
done

if [[ $(uname -s 2>/dev/null) != Linux ]]; then
  printf '%s\n' 'ERROR=Linux is required; no sampling performed' >&2
  exit 69
fi

failures=0
section() {
  local label=$1
  shift
  printf 'BEGIN %s\n' "$label"
  if "$@" 2>/dev/null; then
    printf '%s\n' 'STATUS=OK'
  else
    printf '%s\n' 'STATUS=UNAVAILABLE_OR_FAILED'
    failures=$((failures + 1))
  fi
  printf 'END %s\n' "$label"
}

pressure() {
  section "${1}_cpu_pressure" cat /proc/pressure/cpu
  section "${1}_memory_pressure" cat /proc/pressure/memory
  section "${1}_io_pressure" cat /proc/pressure/io
  section "${1}_kernel_counters" awk '$1 ~ /^(oom_kill|pgmajfault|pswpin|pswpout)$/ {print $1, $2}' /proc/vmstat
}

printf '%s\n' 'FORMAT=doon-cloud-capacity-probe-v1' 'MODE=PASSIVE_READ_ONLY' 'SAMPLE_SECONDS=10'
printf '%s\n' 'IDENTIFIERS=NO_HOSTNAME_IP_CMDLINE_ENV' 'VMSTAT_FIRST_DATA_ROW=BOOT_AVERAGE_DISCARD'
section started_at date -u +%FT%TZ
section kernel uname -srmo
section online_cpus getconf _NPROCESSORS_ONLN
section memory_before free -b
section disk_bytes df -B1 --output=fstype,size,used,avail,pcent,target / /tmp
section disk_inodes df --output=itotal,iused,iavail,ipcent,target / /tmp
pressure before
# 11 reports: one since-boot average followed by ten one-second intervals.
# Deliberately fixed: callers cannot request longer runs or higher sampling rates.
section vmstat_10_seconds vmstat -w 1 11
section memory_after free -b
pressure after

printf '%s\n' 'BEGIN listening_ports' 'COLUMNS=protocol port bind_scope'
if sockets=$(ss -H -lntu 2>/dev/null); then
  # Never print socket addresses. Listing kernel sockets does not connect to 8787.
  printf '%s\n' "$sockets" | awk '
    NF >= 6 && $1 ~ /^(tcp|udp)$/ {
      address=$5; sub(/:[^:]*$/, "", address);
      port=$5; sub(/^.*:/, "", port);
      if (port !~ /^[0-9]+$/) next;
      port += 0;
      if (port < 1 || port > 65535) next;
      scope=(address=="127.0.0.1" || address=="[::1]" || address=="::1") ? "loopback" :
            (address=="0.0.0.0" || address=="*" || address=="[::]" || address=="::") ? "wildcard" : "specific";
      print $1, port, scope;
    }' | sort -u
  printf '%s\n' 'STATUS=OK'
else
  printf '%s\n' 'STATUS=UNAVAILABLE_OR_FAILED'
  failures=$((failures + 1))
fi
printf '%s\n' 'END listening_ports'

# No unit enumeration, descriptions, ExecStart, Environment, status or journal.
properties=(Id LoadState ActiveState SubState MainPID NRestarts TasksCurrent MemoryCurrent MemoryPeak MemorySwapCurrent CPUUsageNSec MemoryHigh MemoryMax MemorySwapMax)
property_args=()
for property in "${properties[@]}"; do property_args+=("--property=$property"); done
if ((${#services[@]} == 0)); then
  printf '%s\n' 'SERVICES=SKIPPED_NO_EXPLICIT_ALLOWLIST'
else
  for unit in "${services[@]}"; do
    section "service:$unit" systemctl --no-pager show "${property_args[@]}" -- "$unit"
  done
fi
section finished_at date -u +%FT%TZ
if ((failures)); then
  printf 'RESULT=INCOMPLETE unavailable_sections=%s\n' "$failures"
  exit 2
fi
printf '%s\n' 'RESULT=OBSERVATION_ONLY_NOT_CAPACITY_ACCEPTANCE'
