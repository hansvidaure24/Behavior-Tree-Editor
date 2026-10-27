// MiniJSON — minimal JSON parser for Unity.
// Public domain. Handles the subset we need: objects, arrays, strings, numbers, bools, null.

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
            if (string.IsNullOrEmpty(json)) return null;
            return new Parser(json).ParseValue();
        }

        class Parser
        {
            readonly string _json;
            int _pos;

            public Parser(string json) { _json = json; _pos = 0; }

            void SkipWhitespace() { while (_pos < _json.Length && char.IsWhiteSpace(_json[_pos])) _pos++; }

            char Peek() { SkipWhitespace(); return _pos < _json.Length ? _json[_pos] : '\0'; }
            char Next() { SkipWhitespace(); return _pos < _json.Length ? _json[_pos++] : '\0'; }

            public object ParseValue()
            {
                char c = Peek();
                if (c == '{') return ParseObject();
                if (c == '[') return ParseArray();
                if (c == '"') return ParseString();
                if (c == 't' || c == 'f') return ParseBool();
                if (c == 'n') { _pos += 4; return null; }
                return ParseNumber();
            }

            Dictionary<string, object> ParseObject()
            {
                var dict = new Dictionary<string, object>();
                Next(); // {
                while (Peek() != '}')
                {
                    var key = ParseString();
                    Next(); // :
                    dict[key] = ParseValue();
                    if (Peek() == ',') Next();
                }
                Next(); // }
                return dict;
            }

            List<object> ParseArray()
            {
                var list = new List<object>();
                Next(); // [
                while (Peek() != ']')
                {
                    list.Add(ParseValue());
                    if (Peek() == ',') Next();
                }
                Next(); // ]
                return list;
            }

            string ParseString()
            {
                Next(); // opening "
                var sb = new StringBuilder();
                while (_pos < _json.Length)
                {
                    char c = _json[_pos++];
                    if (c == '"') break;
                    if (c == '\\')
                    {
                        c = _json[_pos++];
                        switch (c)
                        {
                            case '"': case '\\': case '/': sb.Append(c); break;
                            case 'n': sb.Append('\n'); break;
                            case 't': sb.Append('\t'); break;
                            case 'r': sb.Append('\r'); break;
                            case 'u':
                                sb.Append((char)int.Parse(_json.Substring(_pos, 4), NumberStyles.HexNumber));
                                _pos += 4;
                                break;
                        }
                    }
                    else sb.Append(c);
                }
                return sb.ToString();
            }

            bool ParseBool()
            {
                if (_json[_pos] == 't') { _pos += 4; return true; }
                _pos += 5; return false;
            }

            double ParseNumber()
            {
                SkipWhitespace();
                int start = _pos;
                while (_pos < _json.Length && "0123456789+-.eE".IndexOf(_json[_pos]) >= 0) _pos++;
                return double.Parse(_json.Substring(start, _pos - start), CultureInfo.InvariantCulture);
            }
        }
    }
}
