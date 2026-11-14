import sys
import zlib

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"


def encode(text):
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    data = compressor.compress(text.encode("utf-8")) + compressor.flush()
    out = []
    for i in range(0, len(data), 3):
        chunk = data[i:i + 3]
        b1 = chunk[0]
        b2 = chunk[1] if len(chunk) > 1 else 0
        b3 = chunk[2] if len(chunk) > 2 else 0
        out.append(ALPHABET[b1 >> 2])
        out.append(ALPHABET[((b1 & 0x3) << 4) | (b2 >> 4)])
        if len(chunk) > 1:
            out.append(ALPHABET[((b2 & 0xF) << 2) | (b3 >> 6)])
        if len(chunk) > 2:
            out.append(ALPHABET[b3 & 0x3F])
    return "".join(out)


if __name__ == "__main__":
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        print(encode(f.read()))
