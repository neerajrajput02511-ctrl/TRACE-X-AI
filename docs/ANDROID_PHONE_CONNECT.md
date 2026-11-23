# Connect an Android phone to TRACE-X AI

## Same Wi-Fi synthetic demo

1. Run the team server from the repository root on the laptop. Create the demo investigator and reviewer accounts if needed.

   ```powershell
   npm.cmd run user -- analyst investigator Jaipur
   npm.cmd run user -- reviewer reviewer Jaipur
   .\START_TRACEX.bat -Lan
   ```

2. Open a second terminal and find the laptop's Wi-Fi IPv4 address with `ipconfig`. Use the **Wi-Fi** adapter address, such as `192.168.1.20`. Connect the phone to the same Wi-Fi. The server listens on port 4318 by default.
3. Open `http://<laptop-wifi-ip>:4318/login.html` in the phone browser to check reachability. If Windows Firewall blocks the connection, allow TCP port 4318 for the Private profile and local subnet. Run this only from an administrator PowerShell on a trusted network.

   ```powershell
   New-NetFirewallRule -DisplayName 'TRACE-X local demo' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4318 -Profile Private -RemoteAddress LocalSubnet
   ```

4. Install the **debug APK**. Open **Server settings**, enter the origin only, such as `http://192.168.1.20:4318`, and select **Connect to team server**. Android asks for confirmation because HTTP sends credentials and data without encryption. Use disposable demo accounts and synthetic records on the trusted LAN. Sign in using the same team accounts as the laptop.
5. Create or select a case in the Windows browser. Refresh the phone workspace to see the same case and the changes allowed for your signed-in account.

The Android Studio emulator maps `10.0.2.2` to the Windows host loopback. When both run on the same laptop, enter `http://10.0.2.2:4318` in the debug APK. On a physical phone, use the laptop's Wi-Fi address.

## HTTPS for a signed release

Terminate HTTPS in front of the same team server using a certificate trusted by Android and issued for the configured hostname. Set `TRACEX_SECURE_COOKIES=1` on the team server. Pass the original host header through the reverse proxy. Enter the origin, such as `https://tracex.example.org`, in the Android app. Keep API and console paths on the same origin.

## Connection and session recovery

- **Retry connection** retries the selected server. **Server settings** changes its address. Verify that the laptop is awake, the server is running, and the Wi-Fi lets devices reach one another.
- If the session expires, sign in again. Do the same if a signed report download reports an expired session.
- **Explore offline sample** opens the bundled read-only synthetic case. Connected writes require the team server. They are not queued offline.
