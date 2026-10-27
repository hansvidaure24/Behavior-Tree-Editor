class_name TimeoutNode
extends BTNode

var _start_time: float = -1.0

func _on_tick(bb: Blackboard) -> Status:
	if children.is_empty():
		return Status.FAILURE
	var now: float = Time.get_ticks_msec() / 1000.0
	if _start_time < 0:
		_start_time = now
	var seconds: float = float(parameters.get("seconds", 5))
	if now - _start_time > seconds:
		_start_time = -1.0
		return Status.FAILURE
	var status = children[0].tick(bb)
	if status != Status.RUNNING:
		_start_time = -1.0
	return status
