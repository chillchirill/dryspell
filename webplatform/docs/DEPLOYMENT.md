# Deployment and operations

The implementation targets Node 24, one PostgreSQL/PostGIS container, one Express process and one worker. HTTP and WS share port 4000. React and server entry points are compiled by the build; systemd runs the resulting JavaScript without a TypeScript loader. The installer preserves existing Docker volumes. Database port 55432 binds only loopback. Runtime processes use the unprivileged dryspell account; private configuration is under /etc/dryspell and persistent artifacts under /var/lib/dryspell.

Run `sudo -E bash scripts/install.sh --port 4000` on Ubuntu, supplying DRYSPELL_ADMIN_PASSWORD for first noninteractive installation (12+ characters). The password is hashed with a random salt and never printed or bundled. Existing administrator and database credentials are preserved. Use the setup-admin script with --replace only for a deliberate password reset.

The installer checks Ubuntu, architecture, disk/memory and port conflicts, installs Docker from its official apt repository when missing, uses Node 24.14.1 with SHA256 verification when Node 24 is missing, installs locked npm dependencies, builds, migrates under a database lock, seeds the prepared scenario and starts systemd units. It modifies active UFW only by adding 4000/tcp. Other firewalls/security groups are reported for explicit configuration. It does not enable UFW or alter SSH rules.

`scripts/start.sh`, `stop.sh`, `status.sh` control only Dryspell services. Health and worker state are available at /health/ready. The daily maintenance timer aggregates hourly telemetry before retaining raw rows for 90 days and aggregate rows for 365 days. Values include min/max/count/mean so critical peaks survive aggregation; missing channels create no zero records.

`sudo bash scripts/backup.sh` pauses writers and captures a PostgreSQL custom dump, private config and managed artifacts with checksums. Backups contain secrets and use restrictive permissions. `sudo bash scripts/restore.sh /path/to/backup --replace-current` verifies checksums before replacing platform state and restarts services. Backups require independent off-host storage; this script does not claim off-host replication.

For public credentials, configure the optional TLS proxy in deploy/nginx.example.conf and set SESSION_SECURE=true. HTTP port 4000 remains the application port. External security groups and DNS/certificates cannot be verified without access.

## Evidence boundary

Windows/Docker/WSL checks and clean Ubuntu deployment are distinct. See WORK_STATUS.md for executed commands. A shell syntax check or systemd unit validation does not establish fresh install, reboot, firewall or restoration success.

## Reviewed official references

2026-11-14 source reading: Docker Ubuntu apt installation (https://docs.docker.com/engine/install/ubuntu/), Node release status (https://nodejs.org/en/about/previous-releases), systemd service semantics (https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html). These were consulted for deployment implementation; no deployment is implied by reading them.
