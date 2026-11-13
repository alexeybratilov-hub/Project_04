import os
import struct

def create_windows_exe(output_exe_path: str, html_payload_path: str):
    with open(html_payload_path, 'rb') as f:
        payload_data = f.read()

    marker = b'---PAYLOAD_START---'
    payload = marker + payload_data

    # Windows batch command to execute when OT-Baza.exe is launched
    # 1. Creates data, documents, normatives, templates in its root catalog
    # 2. Extracts app.html from its own executable if not present
    # 3. Launches in native Windows desktop window via Edge App mode or default browser
    cmd = (
        'cmd.exe /c "title OT-Baza & '
        'if not exist data mkdir data & '
        'if not exist documents mkdir documents & '
        'if not exist normatives mkdir normatives & '
        'if not exist templates mkdir templates & '
        'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command '
        '\\"$e=\\\'%~dp0OT-Baza.exe\\\'; $h=\\\'%~dp0app.html\\\'; '
        'if (-not (Test-Path $h) -and (Test-Path $e)) { '
        '$b=[System.IO.File]::ReadAllBytes($e); '
        '$m=[System.Text.Encoding]::ASCII.GetBytes(\\\'---PAYLOAD_START---\\\'); '
        '$idx=-1; '
        'for ($i=0; $i -lt ($b.Length - $m.Length); $i++) { '
        '$ok=$true; for ($j=0; $j -lt $m.Length; $j++) { if ($b[$i+$j] -ne $m[$j]) { $ok=$false; break } }; '
        'if ($ok) { $idx=$i+$m.Length; break } }; '
        'if ($idx -ge 0) { [System.IO.File]::WriteAllBytes($h, $b[$idx..($b.Length-1)]) } '
        '}\\" & '
        'start msedge.exe --app=\\"%~dp0app.html\\" || start \\"\\" \\"%~dp0app.html\\""'
    )

    # DOS Header
    dos_header = bytearray(0x40)
    dos_header[0:2] = b'MZ'
    struct.pack_into('<I', dos_header, 0x3C, 0x40)

    # PE Signature + COFF
    pe_sig = b'PE\x00\x00'
    coff = struct.pack('<HHIIIHH', 0x8664, 1, 0, 0, 0, 0xF0, 0x0022)

    entry_point = 0x1000
    image_base = 0x140000000
    section_align = 0x1000
    file_align = 0x200

    # Layout in .text section:
    # 0x1000: entry code (35 bytes)
    # 0x1040: IAT (3 * 8 = 24 bytes)
    # 0x1060: Hint/Names (32 bytes)
    # 0x1090: IDT (40 bytes)
    # 0x10C0: DLL Name (16 bytes)
    # 0x1100: cmd_str
    disp_cmd = 0x1100 - 0x100B
    disp_winexec = 0x1040 - 0x1016
    disp_exit = 0x1048 - 0x101E

    code = bytearray(0x40)
    code[0:4] = b'\x48\x83\xec\x28'
    code[4:11] = b'\x48\x8d\x0d' + struct.pack('<i', disp_cmd)
    code[11:16] = b'\xba\x00\x00\x00\x00' # SW_HIDE
    code[16:22] = b'\xff\x15' + struct.pack('<i', disp_winexec)
    code[22:24] = b'\x31\xc9'
    code[24:30] = b'\xff\x15' + struct.pack('<i', disp_exit)
    code[30:34] = b'\x48\x83\xc4\x28'
    code[34:35] = b'\xc3'

    # IAT at 0x1040
    iat = bytearray(0x20)
    struct.pack_into('<Q', iat, 0, 0x1060) # WinExec hint/name RVA
    struct.pack_into('<Q', iat, 8, 0x1070) # ExitProcess hint/name RVA
    struct.pack_into('<Q', iat, 16, 0)     # null terminator

    # Hint/Names at 0x1060
    hint_names = bytearray(0x30)
    hint_names[0:10] = b'\x00\x00WinExec\x00'
    hint_names[0x10:0x20] = b'\x00\x00ExitProcess\x00'

    # IDT at 0x1090
    idt = bytearray(40)
    struct.pack_into('<IIIII', idt, 0,
        0x1040, # OriginalFirstThunk -> IAT
        0,      # TimeDateStamp
        0,      # ForwarderChain
        0x10C0, # Name -> KERNEL32.dll
        0x1040  # FirstThunk -> IAT
    )

    dll_name = b'KERNEL32.dll\x00'
    dll_name += b'\x00' * (0x40 - len(dll_name))

    cmd_bytes = cmd.encode('utf-8') + b'\x00'

    text_content = code + iat + hint_names + idt + dll_name + cmd_bytes
    raw_size = ((len(text_content) + file_align - 1) // file_align) * file_align
    text_content += b'\x00' * (raw_size - len(text_content))

    v_size = ((raw_size + section_align - 1) // section_align) * section_align
    size_of_image = 0x1000 + v_size
    size_of_headers = 0x200

    # Optional Header PE32+
    opt_header = struct.pack('<HBBIIIIIQIIHHHHHHIIIIHHQQQQII',
        0x020B, 14, 0,
        raw_size, 0, 0,
        entry_point, 0x1000,
        image_base, section_align, file_align,
        6, 0, 0, 0, 6, 0, 0,
        size_of_image, size_of_headers, 0,
        2, # Subsystem 2 = Windows GUI
        0x8160, # DllCharacteristics
        0x100000, 0x1000, 0x100000, 0x1000,
        0, 16
    )

    data_dirs = bytearray(16 * 8)
    struct.pack_into('<II', data_dirs, 1 * 8, 0x1090, 40)
    struct.pack_into('<II', data_dirs, 12 * 8, 0x1040, 24)

    sec_header = struct.pack('<8sIIIIIIHHI',
        b'.text\x00\x00\x00',
        v_size, 0x1000,
        raw_size, 0x200,
        0, 0, 0, 0,
        0x60000020
    )

    headers = dos_header + pe_sig + coff + opt_header + data_dirs + sec_header
    headers += b'\x00' * (file_align - len(headers))

    full_exe = headers + text_content + payload

    with open(output_exe_path, 'wb') as f:
        f.write(full_exe)

    print(f'Successfully built Windows executable: {output_exe_path} ({len(full_exe)} bytes)')

if __name__ == '__main__':
    os.makedirs('public/download', exist_ok=True)
    create_windows_exe('public/download/OT-Baza.exe', 'public/app.html')
