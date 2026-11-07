// MiniJSON — minimal JSON parser for Unity. Objects → Dictionary<string, object>, arrays → List<object>,
// numbers → double, plus string / bool / null. Malformed or truncated input throws FormatException
// (a half-written file during hot reload must fail cleanly, never hang).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace BehaviorTreeRuntime
{
    public static class MiniJson
    {
        public static object Deserialize(string json)
        {
            if (string.IsNullOrEmpty(json)) throw new FormatException("empty input");
            var parser = new Parser(json);
            var value = parser.ParseValue();
            parser.ExpectEnd();
            return value;
        }

        sealed class Parser
        {
            readonly string _json;
            int _pos;

            public Parser(string json) { _json = json.Length > 0 && json[0] == '﻿' ? json.Substring(1) : json; }

            FormatException Error(string what) => new FormatException($"{what} at position {_pos}");

            void SkipWhitespace() { while (_pos < _json.Length && char.IsWhiteSpace(_json[_pos])) _pos++; }

            char Peek()
            {
                SkipWhitespace();
                if (_pos >= _json.Length) throw Error("unexpected end of input");
                return _json[_pos];
            }

            void Expect(char c)
            {
                if (Peek() != c) throw Error($"expected '{c}'");
                _pos++;
            }

            public void ExpectEnd()
            {
                SkipWhitespace();
                if (_pos < _json.Length) throw Error("unexpected trailing characters");
            }

            public object ParseValue()
            {
                char c = Peek();
                switch (c)
                {
                    case '{': return ParseObject();
                    case '[': return ParseArray();
                    case '"': return ParseString();
                    case 't': Literal("true"); return true;
                    case 'f': Literal("false"); return false;
                    case 'n': Literal("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ParseNumber();
                        throw Error($"unexpected character '{c}'");
                }
            }

            void Literal(string word)
            {
                if (string.CompareOrdinal(_json, _pos, word, 0, word.Length) != 0) throw Error($"expected {word}");
                _pos += word.Length;
            }

            Dictionary<string, object> ParseObject()
            {
                var dict = new Dictionary<string, object>();
                Expect('{');
                if (Peek() == '}') { _pos++; return dict; }
                while (true)
                {
                    if (Peek() != '"') throw Error("expected a string key");
                    var key = ParseString();
                    Expect(':');
                    dict[key] = ParseValue();
                    char c = Peek();
                    _pos++;
                    if (c == '}') return dict;
                    if (c != ',') throw Error("expected ',' or '}'");
                }
            }

            List<object> ParseArray()
            {
                var list = new List<object>();
                Expect('[');
                if (Peek() == ']') { _pos++; return list; }
                while (true)
                {
                    list.Add(ParseValue());
                    char c = Peek();
                    _pos++;
                    if (c == ']') return list;
                    if (c != ',') throw Error("expected ',' or ']'");
                }
            }

            string ParseString()
            {
                Expect('"');
                var sb = new StringBuilder();
                while (true)
                {
                    if (_pos >= _json.Length) throw Error("unterminated string");
                    char c = _json[_pos++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (_pos >= _json.Length) throw Error("unterminated escape");
                    c = _json[_pos++];
                    switch (c)
                    {
                        case '"': case '\\': case '/': sb.Append(c); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_pos + 4 > _json.Length || !int.TryParse(_json.Substring(_pos, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int code))
                                throw Error("bad \\u escape");
                            sb.Append((char)code);
                            _pos += 4;
                            break;
                        default: throw Error($"bad escape '\\{c}'");
                    }
                }
            }

            double ParseNumber()
            {
                int start = _pos;
                while (_pos < _json.Length && "0123456789+-.eE".IndexOf(_json[_pos]) >= 0) _pos++;
                if (!double.TryParse(_json.Substring(start, _pos - start), NumberStyles.Float, CultureInfo.InvariantCulture, out double d))
                    throw Error("bad number");
                return d;
            }
        }
    }
}
