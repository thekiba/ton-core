/**
 * Copyright (c) Whales Corp. 
 * All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Address } from "../address/Address";
import { ExternalAddress } from "../address/ExternalAddress";
import { bitsForNumber } from "../utils/bitsForNumber";
import { Maybe } from "../utils/maybe";
import { BitString } from "./BitString";

/**
 * Class for building bit strings
 */
export class BitBuilder {
    private _buffer: Buffer;
    private _length: number;

    constructor(size: number = 1023) {
        this._buffer = Buffer.alloc(Math.ceil(size / 8));
        this._length = 0;
    }

    /**
     * Current number of bits written
     */
    get length() {
        return this._length;
    }

    /**
     * Write a single bit
     * @param value bit to write, true or positive number for 1, false or zero or negative for 0
     */
    writeBit(value: boolean | number) {

        // Check overflow
        let n = this._length;
        if (n > this._buffer.length * 8) {
            throw new Error("BitBuilder overflow");
        }

        // Set bit
        if (value === true || value > 0) {
            this._buffer[(n / 8) | 0] |= 1 << (7 - (n % 8));
        }

        // Advance
        this._length++;
    }

    /**
     * Copy bits from BitString
     * @param src source bits
     */
    writeBits(src: BitString) {
        for (let i = 0; i < src.length; i++) {
            this.writeBit(src.at(i));
        }
    }

    /**
     * Write bits from buffer
     * @param src source buffer
     */
    writeBuffer(src: Buffer) {

        // Special case for aligned offsets
        if (this._length % 8 === 0) {
            if (this._length + src.length * 8 > this._buffer.length * 8) {
                throw new Error("BitBuilder overflow");
            }
            src.copy(this._buffer, this._length / 8);
            this._length += src.length * 8;
        } else {
            for (let i = 0; i < src.length; i++) {
                this.writeUint(src[i], 8);
            }
        }
    }

    /**
     * Write uint value
     * @param value value as bigint or number
     * @param bits number of bits to write
     */
    writeUint(value: bigint | number, bits: number) {

        // Special case for 8 bits
        if (bits === 8 && this._length % 8 === 0) {
            let v = Number(value);
            if (v < 0 || v > 255 || !Number.isSafeInteger(v)) {
                throw Error(`value is out of range for ${bits} bits. Got ${value}`);
            }
            this._buffer[this._length / 8] = Number(value);
            this._length += 8;
            return;
        }

        // Special case for 16 bits
        if (bits === 16 && this._length % 8 === 0) {
            let v = Number(value);
            if (v < 0 || v > 65536 || !Number.isSafeInteger(v)) {
                throw Error(`value is out of range for ${bits} bits. Got ${value}`);
            }
            this._buffer[this._length / 8] = v >> 8;
            this._buffer[this._length / 8 + 1] = v & 0xff;
            this._length += 16;
            return;
        }

        // Generic case
        let v = BigInt(value);
        if (bits < 0 || !Number.isSafeInteger(bits)) {
            throw Error(`invalid bit length. Got ${bits}`);
        }

        // Corner case for zero bits
        if (bits === 0) {
            if (value !== 0n) {
                throw Error(`value is not zero for ${bits} bits. Got ${value}`);
            } else {
                return;
            }
        }

        // Check input
        let vBits = (1n << BigInt(bits));
        if (v < 0 || v >= vBits) {
            throw Error(`bitLength is too small for a value ${value}. Got ${bits}`);
        }

        // Convert number to bits
        let b: boolean[] = [];
        while (v > 0) {
            b.push(v % 2n === 1n);
            v /= 2n;
        }

        // Write bits
        for (let i = 0; i < bits; i++) {
            let off = bits - i - 1;
            if (off < b.length) {
                this.writeBit(b[off]);
            } else {
                this.writeBit(false);
            }
        }
    }

    /**
     * Write int value
     * @param value value as bigint or number
     * @param bits number of bits to write
     */
    writeInt(value: bigint | number, bits: number) {
        let v = BigInt(value);
        if (bits < 0 || !Number.isSafeInteger(bits)) {
            throw Error(`invalid bit length. Got ${bits}`);
        }

        // Corner case for zero bits
        if (bits === 0) {
            if (value !== 0n) {
                throw Error(`value is not zero for ${bits} bits. Got ${value}`);
            } else {
                return;
            }
        }

        // Corner case for one bit
        if (bits === 1) {
            if (value !== -1n && value !== 0n) {
                throw Error(`value is not zero or -1 for ${bits} bits. Got ${value}`);
            } else {
                this.writeBit(value === -1n);
                return;
            }
        }

        // Check input
        let vBits = 1n << (BigInt(bits) - 1n);
        if (v < -vBits || v >= vBits) {
            throw Error(`value is out of range for ${bits} bits. Got ${value}`);
        }

        // Write sign
        if (v < 0) {
            this.writeBit(true);
            v = vBits + v;
        } else {
            this.writeBit(false);
        }

        // Write value
        this.writeUint(v, bits - 1);
    }

    /**
     * Wrtie var uint value, used for serializing coins
     * @param value value to write as bigint or number
     * @param bits header bits to write size
     */
    writeVarUint(value: number | bigint, bits: number) {
        let v = BigInt(value);
        if (bits < 0 || !Number.isSafeInteger(bits)) {
            throw Error(`invalid bit length. Got ${bits}`);
        }
        if (v < 0) {
            throw Error(`value is negative. Got ${value}`);
        }

        // Corner case for zero
        if (v === 0n) {
            // Write zero size
            this.writeUint(0, bits);
            return;
        }

        // Calculate size
        const sizeBytes = Math.ceil((v.toString(2).length) / 8); // Fastest way in most environments
        const sizeBits = sizeBytes * 8;

        // Write size
        this.writeUint(sizeBytes, bits);

        // Write number
        this.writeUint(v, sizeBits);
    }

    /**
     * Wrtie var int value, used for serializing coins
     * @param value value to write as bigint or number
     * @param bits header bits to write size
     */
    writeVarInt(value: number | bigint, bits: number) {
        let v = BigInt(value);
        if (bits < 0 || !Number.isSafeInteger(bits)) {
            throw Error(`invalid bit length. Got ${bits}`);
        }

        // Corner case for zero
        if (v === 0n) {
            // Write zero size
            this.writeUint(0, bits);
            return;
        }

        // Calculate size
        let v2 = v > 0 ? v : -v;
        const sizeBytes = 1 + Math.ceil((v2.toString(2).length) / 8); // Fastest way in most environments
        const sizeBits = sizeBytes * 8;

        // Write size
        this.writeUint(sizeBytes, bits);

        // Write number
        this.writeInt(v, sizeBits);
    }

    /**
     * Write coins in var uint format
     * @param amount amount to write
     */
    writeCoins(amount: number | bigint) {
        this.writeVarUint(amount, 4);
    }

    /**
     * Write address
     * @param address write address or address external 
     */
    writeAddress(address: Maybe<Address | ExternalAddress>) {

        // Is empty address
        if (address === null || address === undefined) {
            this.writeUint(0, 2); // Empty address
            return;
        }

        // Is Internal Address
        if (Address.isAddress(address)) {
            this.writeUint(2, 2); // Internal address
            this.writeUint(0, 1); // No anycast
            this.writeInt(address.workChain, 8);
            this.writeBuffer(address.hash);
            return;
        }

        // Is External Address
        if (ExternalAddress.isAddress(address)) {
            this.writeUint(1, 2); // External address
            this.writeUint(address.bits, 9);
            this.writeUint(address.value, address.bits);
            return;
        }

        // Invalid address
        throw Error(`Invalid address. Got ${address}`);
    }

    /**
     * Build BitString
     * @returns result bit string
     */
    build() {
        return new BitString(this._buffer, 0, this._length);
    }

    /**
     * Build into Buffer
     * @returns result buffer
     */
    buffer() {
        if (this._length % 8 !== 0) {
            throw new Error("BitBuilder buffer is not byte aligned");
        }
        return this._buffer.subarray(0, this._length / 8);
    }
}