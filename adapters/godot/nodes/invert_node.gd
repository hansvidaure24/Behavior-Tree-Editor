class_name InvertNode
extends BTNode

func _on_tick(bb: Blackboard) -> Status:
	if children.is_empty():
		return Status.FAILURE
	var status = children[0].tick(bb)
	match status:
		Status.SUCCESS: return Status.FAILURE
		Status.FAILURE: return Status.SUCCESS
		_: return status
