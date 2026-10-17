package ruptela

// crc16Kermit is CRC-CCITT (Kermit) as specified in the Ruptela FM protocol
// (poly 0x8408 = reflected 0x1021, init 0). CRC covers the payload after the
// 2-byte length field (not including length or the CRC itself).
func crc16Kermit(data []byte) uint16 {
	var crc uint16
	const poly uint16 = 0x8408
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ poly
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
