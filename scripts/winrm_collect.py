#!/usr/bin/env python3
"""
Coleta informações de hardware e software de uma máquina Windows via WinRM.
Uso: python3 winrm_collect.py <ip> <domain> <username> <password>
Saída: JSON com cpu, ram_gb, disk_gb, os, software[]
"""
import sys, json
import winrm

def run_ps(session, cmd):
    try:
        r = session.run_ps(cmd)
        return r.std_out.decode("utf-8", errors="replace").strip()
    except:
        return ""

def main():
    if len(sys.argv) < 5:
        print(json.dumps({"error": "Argumentos insuficientes"}))
        sys.exit(1)

    ip       = sys.argv[1]
    domain   = sys.argv[2]
    username = sys.argv[3]
    password = sys.argv[4]

    user = f"{domain}\\{username}" if domain else username

    try:
        session = winrm.Session(
            f"http://{ip}:5985/wsman",
            auth=(user, password),
            transport="ntlm",
            operation_timeout_sec=30,
            read_timeout_sec=35,
        )

        # OS
        os_name = run_ps(session, "(Get-WmiObject Win32_OperatingSystem).Caption")

        # CPU
        cpu = run_ps(session, "(Get-WmiObject Win32_Processor | Select-Object -First 1).Name")

        # RAM em GB
        ram_raw = run_ps(session, "(Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory")
        try:
            ram_gb = round(int(ram_raw) / 1073741824, 1)
        except:
            ram_gb = None

        # Disco total em GB (soma de todos os discos)
        disk_raw = run_ps(session, "(Get-WmiObject Win32_DiskDrive | Measure-Object -Property Size -Sum).Sum")
        try:
            disk_gb = round(int(disk_raw) / 1073741824, 0)
        except:
            disk_gb = None

        # MAC address
        mac = run_ps(session, "(Get-WmiObject Win32_NetworkAdapterConfiguration | Where-Object {$_.IPEnabled} | Select-Object -First 1).MACAddress")

        # Softwares via registro (muito mais rápido que Win32_Product)
        sw_cmd = """
$paths = @(
    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$sw = Get-ItemProperty $paths -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
    Sort-Object DisplayName
$sw | ConvertTo-Json -Compress
"""
        sw_raw = run_ps(session, sw_cmd)
        try:
            sw_list = json.loads(sw_raw) if sw_raw else []
            if isinstance(sw_list, dict):
                sw_list = [sw_list]
        except:
            sw_list = []

        result = {
            "os":      os_name or None,
            "cpu":     cpu or None,
            "ram_gb":  ram_gb,
            "disk_gb": int(disk_gb) if disk_gb else None,
            "mac":     mac or None,
            "software": [
                {
                    "name":         s.get("DisplayName", ""),
                    "version":      s.get("DisplayVersion", "") or None,
                    "manufacturer": s.get("Publisher", "") or None,
                    "install_date": s.get("InstallDate", "") or None,
                }
                for s in sw_list if s.get("DisplayName")
            ]
        }
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
