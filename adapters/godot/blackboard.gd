class_name Blackboard
extends RefCounted

var _data: Dictionary = {}

func set_value(key: String, value: Variant) -> void:
	_data[key] = value

func get_value(key: String, fallback: Variant = null) -> Variant:
	return _data.get(key, fallback)

func has_key(key: String) -> bool:
	return _data.has(key)

func remove(key: String) -> void:
	_data.erase(key)

func clear() -> void:
	_data.clear()

func all() -> Dictionary:
	return _data
